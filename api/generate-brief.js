module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const CRON_SECRET   = process.env.CRON_SECRET;

  const auth = req.headers.authorization;
  if (auth && auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });

  const briefType = req.query.type || 'daily';
  const userId    = req.query.userId || null;
  const now       = new Date();
  const today     = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateStr   = now.toISOString().split('T')[0];
  const briefId   = `${briefType}-${dateStr}`;

  const periodLabel = {
    daily:   today,
    weekly:  `Week of ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    monthly: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    yearly:  String(now.getFullYear()),
  }[briefType] || dateStr;

  // ── Load analyst profile ──────────────────────────────────
  let profile = null;
  try {
    const url = userId
      ? `${SUPABASE_URL}/rest/v1/analyst_profiles?user_id=eq.${userId}&limit=1`
      : `${SUPABASE_URL}/rest/v1/analyst_profiles?id=eq.default&limit=1`;
    const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const rows = await r.json();
    if (rows?.[0]?.data) profile = rows[0].data;
  } catch(e) {}

  // ── Load submissions ──────────────────────────────────────
  let analyzed = [], highPri = [], medPri = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc&limit=100`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    if (Array.isArray(rows)) {
      analyzed = rows.filter(s => s.analysis);
      highPri  = analyzed.filter(s => s.analysis?.priority === 'High');
      medPri   = analyzed.filter(s => s.analysis?.priority === 'Medium');
    }
  } catch(e) {}

  // ── Historical context ────────────────────────────────────
  let history = '';
  if (briefType !== 'daily') {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/briefs?type=eq.daily&order=generated_at.desc&limit=7`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      });
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        history = rows.slice(0,5).map(b =>
          `[${b.period_label}] Risk:${b.content?.overall_risk||'?'} — ${(b.content?.overall_assessment||'').slice(0,100)}`
        ).join('\n');
      }
    } catch(e) {}
  }

  // ── Parse news from query param ───────────────────────────
  let newsContext = '';
  let econNews    = '';
  try {
    if (req.query.news) {
      const nd = JSON.parse(decodeURIComponent(req.query.news));
      const cats = nd.categories || {};
      const lines = [];
      for (const [cat, items] of Object.entries(cats)) {
        if (!Array.isArray(items)) continue;
        items.slice(0,5).forEach(item => {
          lines.push(`[${cat}][${item.source_type||item.source}] ${item.headline}: ${item.summary}`);
        });
      }
      newsContext = lines.join('\n');
      econNews = (cats.Economy||[]).slice(0,6).map(i => `${i.headline}: ${i.summary}`).join('\n');
    }
  } catch(e) {}

  const fmt = s => `[${s.date}][${s.analysis?.priority}][${s.analysis?.category}] ${(s.narrative||'').slice(0,120)}`;
  const subBlock = analyzed.length
    ? `HIGH PRIORITY FIELD REPORTS:\n${highPri.slice(0,5).map(fmt).join('\n')}\nMEDIUM PRIORITY:\n${medPri.slice(0,3).map(fmt).join('\n')}`
    : 'No analyzed field submissions available.';

  const profileBlock = profile
    ? `ANALYST PROFILE — Tailor this brief accordingly:
Role: ${profile.role||''} | Unit: ${profile.unit||''} | Command: ${profile.command||''}
AOR: ${profile.aor||''} | Mission: ${profile.mission_area||''}
Priority Topics: ${(profile.priority_topics||[]).join(', ')}
Key Questions: ${(profile.key_questions||'').slice(0,200)}
Tailoring Notes: ${(profile.tailoring_notes||'').slice(0,200)}`
    : '';

  const HEADERS = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
  };

  // ── PROMPT 1: Main intelligence brief ────────────────────
  const p1 = `You are a senior intelligence analyst producing a ${briefType.toUpperCase()} China intelligence brief dated ${today}, focused on informing US Air Force and Department of Defense strategy.
${profileBlock ? '\n' + profileBlock + '\n' : ''}
INPUT DATA:

TODAY'S NEWS DIGEST (from Chinese state media, Western media, and think tanks):
${newsContext || 'Not available — use training knowledge for current assessments.'}

FIELD SUBMISSIONS (firsthand observations — use to corroborate or challenge news):
${subBlock}
${history ? '\nHISTORICAL BRIEF CONTEXT:\n' + history : ''}

ANALYTICAL REQUIREMENTS:
- Frame ALL analysis through the lens of implications for US Air Force and DoD strategy
- Cover: Economy, Regional Goals & International Politics, Military Growth, Technology Development
- Technology: Cover BROAD domains — semiconductors, space & counter-space, 5G/6G, quantum, biotech, green energy (solar/EVs/batteries), nuclear, hypersonics, robotics, cyber, dual-use tech. Do NOT focus only on AI.
- Note where Chinese state media narrative diverges from Western reporting — this is analytically significant
- Where field submissions corroborate or contradict news, note it explicitly
- Be direct, specific, and policy-relevant — write for senior military leadership
${briefType !== 'daily' ? '- Emphasize trajectory, trends, and changes from prior periods' : ''}

Return ONLY raw JSON starting with { and ending with }. No markdown:
{
  "executive_assessment": "5-6 sentences synthesizing the most critical developments across all domains and their collective implication for US Air Force and DoD strategy. Be specific about what has changed, what is accelerating, and what requires immediate attention.",
  "overall_risk": "High|Medium|Low",
  "key_judgments": [
    "One sentence analytic judgment #1 — the most important bottom-line assessment",
    "One sentence analytic judgment #2",
    "One sentence analytic judgment #3"
  ],
  "themes": {
    "economy": {
      "tldr": "One sentence bottom line with DoD relevance.",
      "analysis": "4-5 sentences. Cover trade, economic coercion, defense spending capacity, financial system, sanctions impact, supply chain vulnerabilities relevant to US military.",
      "dod_implications": "2-3 sentences specifically on what this means for US defense planning, acquisition, or strategy.",
      "trends": [
        {"label": "Trend name", "text": "Detailed explanation with evidence.", "direction": "Rising|Falling|Stable|Uncertain"},
        {"label": "Trend name", "text": "Explanation.", "direction": "Rising|Falling|Stable|Uncertain"}
      ],
      "signals": [
        {"label": "Indicator", "value": "Specific value or status", "desc": "Strategic context"},
        {"label": "Indicator", "value": "Value", "desc": "Context"}
      ],
      "risk": "High|Medium|Low",
      "field_corroboration": "One sentence if field reports are relevant, else omit."
    },
    "regional": {
      "tldr": "One sentence bottom line.",
      "analysis": "4-5 sentences on Taiwan Strait, South China Sea, East China Sea, Korean Peninsula, BRI, and China's regional influence operations.",
      "dod_implications": "2-3 sentences on implications for INDOPACOM posture, allied relationships, basing, or contingency planning.",
      "trends": [{"label": "...", "text": "...", "direction": "..."}, {"label": "...", "text": "...", "direction": "..."}],
      "signals": [{"label": "...", "value": "...", "desc": "..."}, {"label": "...", "value": "...", "desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    },
    "military": {
      "tldr": "One sentence bottom line.",
      "analysis": "4-5 sentences on PLA modernization, PLAAF/PLAN/PLARF/PLASSF developments, exercises, A2/AD capabilities, nuclear posture, and joint warfighting.",
      "dod_implications": "2-3 sentences on specific implications for US Air Force operations, basing at Kadena/Andersen/Misawa, or force planning.",
      "trends": [{"label": "...", "text": "...", "direction": "..."}, {"label": "...", "text": "...", "direction": "..."}],
      "signals": [{"label": "...", "value": "...", "desc": "..."}, {"label": "...", "value": "...", "desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    },
    "technology": {
      "tldr": "One sentence bottom line.",
      "analysis": "4-5 sentences spanning multiple tech domains — semiconductors, space, hypersonics, cyber, quantum, biotech, green energy, nuclear, robotics. Note dual-use military-civilian applications.",
      "dod_implications": "2-3 sentences on technology competition implications for US military advantage, acquisition priorities, or export control effectiveness.",
      "trends": [{"label": "...", "text": "...", "direction": "..."}, {"label": "...", "text": "...", "direction": "..."}],
      "signals": [{"label": "...", "value": "...", "desc": "..."}, {"label": "...", "value": "...", "desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    }
  },
  "think_tank_highlights": [
    {"org": "Org name", "title": "Publication title", "key_finding": "One sentence most relevant finding for DoD", "url": "url if available"}
  ],
  "source_count": {"submissions": ${analyzed.length}, "high_priority": ${highPri.length}}
}`;

  // ── PROMPT 2: Economic indicators ────────────────────────
  const p2 = `You are a China economic analyst supporting US DoD strategy. Date: ${today}.

${econNews ? 'RECENT ECONOMY NEWS:\n' + econNews + '\n' : ''}

Using your knowledge of the latest available data, provide a comprehensive China macroeconomic dashboard.

Return ONLY raw JSON starting with { and ending with }. No markdown:
{
  "search_date": "${dateStr}",
  "overview": "3-4 sentences on China's current macroeconomic condition, trajectory, and key risks relevant to US economic competition and defense planning.",
  "dod_relevance": "2 sentences on what the economic picture means for China's defense spending capacity and long-term military modernization.",
  "indicators": [
    {"name": "GDP Growth Rate", "value": "latest %", "previous": "prior period", "trend": "Rising|Falling|Stable|Uncertain", "interpretation": "strategic significance"},
    {"name": "Defense Budget", "value": "latest figure", "previous": "prior year", "trend": "Rising|Falling|Stable|Uncertain", "interpretation": "military capacity implication"},
    {"name": "Retail Sales", "value": "YoY %", "previous": "prior", "trend": "Rising|Falling|Stable|Uncertain", "interpretation": "domestic demand signal"}
  ],
  "pmi": {"manufacturing": "NBS and Caixin figures with dates", "services": "NBS and Caixin figures", "interpretation": "what PMI signals about economic momentum"},
  "trade": {"exports": "YoY %", "imports": "YoY %", "surplus": "$X billion", "key_partners": "US, EU, ASEAN developments", "interpretation": "trade dependency and coercion leverage"},
  "currency": {"usd_cny": "current rate", "trend": "Appreciation|Depreciation|Stable", "pboc_action": "recent PBOC moves", "interpretation": "capital flow and financial stability implications"},
  "real_estate": {"status": "market status", "key_developers": "Evergrande, Country Garden, Vanke status", "policy_response": "govt stabilization measures", "interpretation": "systemic risk and fiscal drag"},
  "inflation": {"cpi": "X%", "ppi": "X%", "interpretation": "deflation risk and consumer demand weakness"},
  "employment": {"urban_unemployment": "X%", "youth_unemployment": "X%", "interpretation": "social stability pressure on CCP"},
  "foreign_investment": {"fdi": "latest figure and trend", "trend": "Rising|Falling|Stable", "interpretation": "business confidence and tech decoupling signal"},
  "debt": {"local_government": "LGFV situation and scale", "corporate": "stress indicators", "household": "debt and consumption outlook", "interpretation": "systemic risk and fiscal capacity for military spending"},
  "forward_indicators": [
    {"name": "Electricity Consumption", "value": "latest reading", "interpretation": "true economic activity signal"},
    {"name": "Rail Freight Volume", "value": "latest reading", "interpretation": "supply chain and industrial activity"},
    {"name": "Li Keqiang Index composite", "value": "assessment", "interpretation": "alternative GDP proxy"}
  ],
  "overall_assessment": "High|Medium-High|Medium|Medium-Low|Low",
  "overall_assessment_text": "3-4 sentences on China's economic health trajectory, key risks, and implications for its ability to sustain military modernization at current pace."
}`;

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 5000, messages: [{ role: 'user', content: p1 }] })
      }),
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2500, messages: [{ role: 'user', content: p2 }] })
      })
    ]);

    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

    function extract(data) {
      const text = (data.content || [])
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text).join('\n')
        .replace(/```json|```/g, '').trim();
      const first = text.indexOf('{');
      const last  = text.lastIndexOf('}');
      if (first === -1 || last === -1) return null;
      let s = text.slice(first, last + 1);
      s = s.replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(s); } catch(e) { return null; }
    }

    const brief = extract(d1);
    const econ  = extract(d2);

    if (!brief) throw new Error('Failed to parse main brief JSON');

    const content = { ...brief };
    if (econ) content.economic_indicators = econ;

    await fetch(`${SUPABASE_URL}/rest/v1/briefs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: briefId, type: briefType, period_label: periodLabel, generated_at: now.toISOString(), content })
    });

    return res.status(200).json({ success: true, briefId, type: briefType, period_label: periodLabel });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
