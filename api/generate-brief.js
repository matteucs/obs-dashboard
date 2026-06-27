module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const now       = new Date();
  const today     = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const dateStr   = now.toISOString().split('T')[0];

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const briefType   = body.type || req.query.type || 'daily';
  const newsData    = body.news || null;
  const briefId     = `${briefType}-${dateStr}`;
  const periodLabel = {
    daily:   today,
    weekly:  `Week of ${now.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`,
    monthly: now.toLocaleDateString('en-US',{month:'long',year:'numeric'}),
    yearly:  String(now.getFullYear()),
  }[briefType] || dateStr;

  // Load Supabase data in parallel
  const [subsRes] = await Promise.allSettled([
    fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc&limit=30`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    ).then(r => r.json()).catch(() => []),
  ]);

  const subs     = Array.isArray(subsRes.value) ? subsRes.value : [];
  const analyzed = subs.filter(s => s.analysis);
  const highPri  = analyzed.filter(s => s.analysis?.priority === 'High');

  let newsBlock = '';
  if (newsData?.categories) {
    const lines = [];
    for (const [cat, items] of Object.entries(newsData.categories)) {
      if (!Array.isArray(items)) continue;
      items.slice(0,3).forEach(i => lines.push(`[${cat}] ${i.headline}: ${i.summary}`));
    }
    newsBlock = lines.join('\n');
  }

  const subCtx = highPri.slice(0,3).map(s =>
    `[${s.analysis?.category}][${s.date}] ${(s.narrative||'').slice(0,100)}`
  ).join('\n') || 'None';

  const prompt = `You are a senior China intelligence analyst writing a ${briefType.toUpperCase()} brief for US Air Force and DoD senior leadership. Date: ${today}.

NEWS DIGEST (Chinese state media + Western + global + think tanks):
${newsBlock || 'Use your training knowledge for current China developments.'}

HIGH PRIORITY FIELD REPORTS:
${subCtx}

Write a comprehensive, detailed intelligence brief. Frame all analysis through the lens of US Air Force and DoD strategic planning. Note where Chinese state media narrative diverges from independent Western reporting — this divergence is itself analytically significant. Technology must cover broad domains: semiconductors, space and counter-space, 5G/6G, quantum computing, hypersonics, biotech, green and nuclear energy, robotics, cyber — not just AI. ${briefType !== 'daily' ? 'Emphasize trends and changes over time.' : ''}

Return ONLY raw JSON starting { ending }:
{
  "executive_assessment": "5-6 sentences synthesizing the most critical developments across all domains and their collective implications for US Air Force and DoD strategy. Be specific about what is accelerating, what has changed, and what requires immediate command attention.",
  "overall_risk": "High|Medium|Low",
  "key_judgments": [
    "KJ1: single declarative sentence — most important strategic judgment",
    "KJ2: second most important judgment",
    "KJ3: third judgment"
  ],
  "themes": {
    "economy": {
      "tldr": "One sentence bottom line with DoD relevance.",
      "analysis": "4-5 sentences covering trade patterns, economic coercion toolkit, defense spending capacity, supply chain vulnerabilities relevant to US military, and sanctions effectiveness.",
      "dod_implications": "2-3 sentences specifically on what this means for US defense acquisition, economic competition strategy, or allied economic security.",
      "trends": [
        {"label": "Trend name", "text": "Detailed explanation with evidence and strategic significance.", "direction": "Rising|Falling|Stable|Uncertain"},
        {"label": "Second trend", "text": "Explanation with evidence.", "direction": "Rising|Falling|Stable|Uncertain"}
      ],
      "signals": [
        {"label": "Indicator name", "value": "Specific value or status", "desc": "Strategic context for DoD planners"},
        {"label": "Second indicator", "value": "Value", "desc": "Context"}
      ],
      "risk": "High|Medium|Low",
      "field_corroboration": "One sentence if field reports corroborate or contradict news. Omit if not relevant."
    },
    "regional": {
      "tldr": "One sentence.",
      "analysis": "4-5 sentences: Taiwan Strait military balance, South China Sea activities, East China Sea tensions, BRI strategic positioning, diplomatic maneuvers, and influence operations.",
      "dod_implications": "2-3 sentences: INDOPACOM posture, basing implications at Kadena/Andersen/Misawa/Guam, allied relationships, contingency planning.",
      "trends": [{"label": "...","text": "...","direction": "..."},{"label": "...","text": "...","direction": "..."}],
      "signals": [{"label": "...","value": "...","desc": "..."},{"label": "...","value": "...","desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    },
    "military": {
      "tldr": "One sentence.",
      "analysis": "4-5 sentences: PLA modernization progress, PLAAF/PLAN/PLARF/PLASSF developments, recent exercises and readiness indicators, A2/AD capability advances, nuclear posture, and joint warfighting integration.",
      "dod_implications": "2-3 sentences: specific implications for USAF operations, fifth-gen survivability, force structure, or deterrence posture.",
      "trends": [{"label": "...","text": "...","direction": "..."},{"label": "...","text": "...","direction": "..."}],
      "signals": [{"label": "...","value": "...","desc": "..."},{"label": "...","value": "...","desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    },
    "technology": {
      "tldr": "One sentence.",
      "analysis": "4-5 sentences spanning multiple domains — do not focus only on AI. Cover semiconductors and chip manufacturing, space and counter-space, hypersonic weapons, cyber capabilities, quantum computing, biotechnology, green and nuclear energy, robotics, and dual-use military-civilian technology.",
      "dod_implications": "2-3 sentences: technology competition implications for US military advantage, acquisition priorities, and export control effectiveness.",
      "trends": [{"label": "...","text": "...","direction": "..."},{"label": "...","text": "...","direction": "..."}],
      "signals": [{"label": "...","value": "...","desc": "..."},{"label": "...","value": "...","desc": "..."}],
      "risk": "High|Medium|Low",
      "field_corroboration": ""
    }
  },
  "think_tank_highlights": [
    {"org": "Organization", "title": "Publication title", "key_finding": "Most relevant finding for DoD planners", "url": null}
  ],
  "source_count": {"submissions": ${analyzed.length}, "high_priority": ${highPri.length}}
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data  = await r.json();
    const text  = (data.content||[]).filter(b=>b.type==='text'&&b.text).map(b=>b.text).join('\n')
      .replace(/```json|```/g,'').trim();
    const first = text.indexOf('{');
    if (first===-1) throw new Error('No JSON in response. Stop_reason: ' + data.stop_reason);

    // Try full response first, then progressively shorter until valid JSON found
    let brief = null;
    const raw = text.slice(first);
    const candidates = [
      raw.slice(0, raw.lastIndexOf('}')+1),   // up to last }
      raw.slice(0, raw.lastIndexOf('}',raw.lastIndexOf('}')-1)+1), // second-to-last }
    ];
    for (const candidate of candidates) {
      try {
        const cleaned = candidate.replace(/,\s*([}\]])/g,'$1');
        brief = JSON.parse(cleaned);
        break;
      } catch(e) {}
    }
    if (!brief) throw new Error('Could not parse JSON. Stop_reason: ' + data.stop_reason + '. Length: ' + text.length);

    await fetch(`${SUPABASE_URL}/rest/v1/briefs`, {
      method: 'POST',
      headers: { apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
      body: JSON.stringify({ id:briefId, type:briefType, period_label:periodLabel, generated_at:now.toISOString(), content:brief })
    });

    return res.status(200).json({ success:true, briefId, type:briefType, period_label:periodLabel });
  } catch(e) {
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
};
