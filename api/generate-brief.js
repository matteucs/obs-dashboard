module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const now     = new Date();
  const today   = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const dateStr = now.toISOString().split('T')[0];

  // Parse body
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const briefType = body.type || req.query.type || 'daily';
  const newsData  = body.news || null;
  const userId    = body.userId || req.query.userId || null;

  const briefId = `${briefType}-${dateStr}`;
  const periodLabel = {
    daily:   today,
    weekly:  `Week of ${now.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`,
    monthly: now.toLocaleDateString('en-US',{month:'long',year:'numeric'}),
    yearly:  String(now.getFullYear()),
  }[briefType] || dateStr;

  // ── Load all data in parallel ─────────────────────────────
  const [profileRes, subsRes, histRes] = await Promise.allSettled([
    // Profile
    fetch(userId
      ? `${SUPABASE_URL}/rest/v1/analyst_profiles?user_id=eq.${userId}&limit=1`
      : `${SUPABASE_URL}/rest/v1/analyst_profiles?id=eq.default&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    ).then(r => r.json()).catch(() => []),

    // Submissions
    fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc&limit=50`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    ).then(r => r.json()).catch(() => []),

    // History (only for non-daily)
    briefType !== 'daily'
      ? fetch(`${SUPABASE_URL}/rest/v1/briefs?type=eq.daily&order=generated_at.desc&limit=5`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        ).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
  ]);

  const profile  = profileRes.status  === 'fulfilled' ? profileRes.value?.[0]?.data || null : null;
  const subsRaw  = subsRes.status     === 'fulfilled' && Array.isArray(subsRes.value) ? subsRes.value : [];
  const histRaw  = histRes.status     === 'fulfilled' && Array.isArray(histRes.value) ? histRes.value : [];

  const analyzed = subsRaw.filter(s => s.analysis);
  const highPri  = analyzed.filter(s => s.analysis?.priority === 'High');
  const medPri   = analyzed.filter(s => s.analysis?.priority === 'Medium');

  const history = histRaw.slice(0,4).map(b =>
    `[${b.period_label}] Risk:${b.content?.overall_risk||'?'} — ${(b.content?.executive_assessment||b.content?.overall_assessment||'').slice(0,80)}`
  ).join('\n');

  // ── Build contexts ────────────────────────────────────────
  const fmt = s => `[${s.date}][${s.analysis?.priority}][${s.analysis?.category}] ${(s.narrative||'').slice(0,100)}`;
  const subBlock = analyzed.length
    ? `HIGH PRIORITY:\n${highPri.slice(0,4).map(fmt).join('\n')}\nMEDIUM:\n${medPri.slice(0,3).map(fmt).join('\n')}`
    : 'No analyzed field submissions.';

  const profileBlock = profile ? `
ANALYST PROFILE: ${profile.role||''} | ${profile.unit||''} | ${profile.command||''}
AOR: ${profile.aor||''} | Topics: ${(profile.priority_topics||[]).join(', ')}` : '';

  // Build news context from passed data
  let newsBlock = '';
  let econBlock = '';
  if (newsData?.categories) {
    const cats = newsData.categories;
    const lines = [];
    for (const [cat, items] of Object.entries(cats)) {
      if (!Array.isArray(items)) continue;
      items.slice(0,4).forEach(i => {
        lines.push(`[${cat}][${i.source_type||i.source}] ${i.headline}: ${i.summary}`);
      });
    }
    newsBlock = lines.join('\n');
    econBlock = (cats.Economy||[]).slice(0,5).map(i => `${i.headline}: ${i.summary}`).join('\n');
  }

  const HEADERS = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
  };

  // ── Prompt 1: Main brief ─────────────────────────────────
  const p1 = `You are a senior China intelligence analyst. Date: ${today}. ${briefType.toUpperCase()} brief for US Air Force and DoD leadership.
${profileBlock}

TODAY'S NEWS FROM MULTIPLE SOURCES (Chinese state media, Western media, think tanks):
${newsBlock || 'Use training knowledge for current China developments.'}

FIELD SUBMISSIONS (firsthand reports):
${subBlock}
${history ? '\nPRIOR BRIEFS:\n' + history : ''}

Write a comprehensive intelligence brief. Frame ALL analysis for US Air Force and DoD strategic planning. Note where Chinese state media narrative diverges from independent reporting. Technology must cover broad domains: semiconductors, space, 5G/6G, quantum, biotech, green/nuclear energy, hypersonics, robotics, cyber — not just AI. ${briefType !== 'daily' ? 'Emphasize trajectory and trend changes.' : ''}

Return ONLY raw JSON starting { ending }:
{"executive_assessment":"5-6 sentence synthesis of most critical developments and implications for US Air Force and DoD strategy. Be specific about what is accelerating, what requires attention, and what has changed.","overall_risk":"High|Medium|Low","key_judgments":["KJ1: most important analytic judgment","KJ2: second judgment","KJ3: third judgment"],"themes":{"economy":{"tldr":"1 sentence with DoD relevance.","analysis":"4-5 sentences: trade patterns, economic coercion, defense spending capacity, supply chain risks, sanctions effects.","dod_implications":"2-3 sentences: implications for US defense acquisition, economic competition, or strategy.","trends":[{"label":"trend name","text":"evidence and significance","direction":"Rising|Falling|Stable|Uncertain"},{"label":"trend2","text":"explanation","direction":"Stable"}],"signals":[{"label":"indicator","value":"specific value","desc":"strategic context"},{"label":"indicator2","value":"value","desc":"context"}],"risk":"High|Medium|Low","field_corroboration":""},"regional":{"tldr":"1 sentence.","analysis":"4-5 sentences: Taiwan Strait, South/East China Sea, Korean Peninsula, BRI, influence operations, diplomatic moves.","dod_implications":"2-3 sentences: INDOPACOM posture, basing, allied relationships, contingency implications.","trends":[{"label":"...","text":"...","direction":"..."},{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."},{"label":"...","value":"...","desc":"..."}],"risk":"High|Medium|Low","field_corroboration":""},"military":{"tldr":"1 sentence.","analysis":"4-5 sentences: PLA modernization, PLAAF/PLAN/PLARF/PLASSF developments, exercises, A2/AD, nuclear posture, joint warfighting.","dod_implications":"2-3 sentences: implications for USAF operations, Kadena/Andersen/Misawa basing, force planning, deterrence.","trends":[{"label":"...","text":"...","direction":"..."},{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."},{"label":"...","value":"...","desc":"..."}],"risk":"High|Medium|Low","field_corroboration":""},"technology":{"tldr":"1 sentence.","analysis":"4-5 sentences across multiple domains: semiconductors, space/counter-space, hypersonics, cyber, quantum, biotech, green energy, nuclear, robotics. Note dual-use applications.","dod_implications":"2-3 sentences: technology competition implications for US military advantage, acquisition priorities, export controls.","trends":[{"label":"...","text":"...","direction":"..."},{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."},{"label":"...","value":"...","desc":"..."}],"risk":"High|Medium|Low","field_corroboration":""}},"think_tank_highlights":[{"org":"org","title":"publication title","key_finding":"most relevant DoD finding","url":"url or null"}],"source_count":{"submissions":${analyzed.length},"high_priority":${highPri.length}}}`;

  // ── Prompt 2: Economic indicators ────────────────────────
  const p2 = `China economic analyst supporting US DoD. Date: ${today}.
${econBlock ? 'ECONOMY NEWS:\n' + econBlock + '\n' : ''}
Return ONLY raw JSON starting { ending }:
{"search_date":"${dateStr}","overview":"3-4 sentences: China macro condition, trajectory, risks relevant to US economic competition.","dod_relevance":"2 sentences: what economic picture means for China defense spending and military modernization capacity.","indicators":[{"name":"GDP Growth","value":"latest %","previous":"prior period","trend":"Rising|Falling|Stable|Uncertain","interpretation":"strategic significance"},{"name":"Defense Budget","value":"latest","previous":"prior year","trend":"Rising","interpretation":"military capacity"},{"name":"Retail Sales","value":"YoY %","previous":"prior","trend":"Rising|Falling|Stable|Uncertain","interpretation":"domestic demand"}],"pmi":{"manufacturing":"NBS and Caixin figures","services":"NBS and Caixin figures","interpretation":"momentum signal"},"trade":{"exports":"YoY %","imports":"YoY %","surplus":"$X bn","key_partners":"US EU ASEAN developments","interpretation":"dependency and coercion leverage"},"currency":{"usd_cny":"rate","trend":"Appreciation|Depreciation|Stable","pboc_action":"recent moves","interpretation":"financial stability implications"},"real_estate":{"status":"market status","key_developers":"Evergrande Country Garden Vanke","policy_response":"stabilization measures","interpretation":"systemic risk and fiscal drag"},"inflation":{"cpi":"X%","ppi":"X%","interpretation":"deflation risk"},"employment":{"urban_unemployment":"X%","youth_unemployment":"X%","interpretation":"social stability pressure"},"foreign_investment":{"fdi":"figure and trend","trend":"Rising|Falling|Stable","interpretation":"decoupling signal"},"debt":{"local_government":"LGFV situation","corporate":"stress indicators","household":"debt outlook","interpretation":"systemic risk and fiscal capacity"},"forward_indicators":[{"name":"Electricity Consumption","value":"reading","interpretation":"true activity"},{"name":"Rail Freight","value":"reading","interpretation":"industrial activity"}],"overall_assessment":"High|Medium-High|Medium|Medium-Low|Low","overall_assessment_text":"3-4 sentences on economic health and ability to sustain military modernization."}`;

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:4000, messages:[{role:'user',content:p1}] })
      }),
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:2000, messages:[{role:'user',content:p2}] })
      })
    ]);

    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

    function extract(data) {
      const text = (data.content||[]).filter(b=>b.type==='text'&&b.text).map(b=>b.text).join('\n')
        .replace(/```json|```/g,'').trim();
      const first = text.indexOf('{'), last = text.lastIndexOf('}');
      if (first===-1||last===-1) return null;
      let s = text.slice(first, last+1).replace(/,\s*([}\]])/g,'$1');
      try { return JSON.parse(s); } catch(e) { return null; }
    }

    const brief = extract(d1);
    const econ  = extract(d2);
    if (!brief) throw new Error('Failed to parse brief JSON. Response: ' + JSON.stringify(d1.content?.slice(0,1)));

    const content = { ...brief };
    if (econ) {
      content.economic_indicators = econ.economic_indicators || econ;
    }

    await fetch(`${SUPABASE_URL}/rest/v1/briefs`, {
      method:'POST',
      headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
      body: JSON.stringify({ id:briefId, type:briefType, period_label:periodLabel, generated_at:now.toISOString(), content })
    });

    return res.status(200).json({ success:true, briefId, type:briefType, period_label:periodLabel });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
