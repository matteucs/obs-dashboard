module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const CRON_SECRET = process.env.CRON_SECRET;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const briefType = req.query.type || 'daily';
  const userId = req.query.userId || null;
  const now = new Date();

  const periodLabel = {
    daily:   now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    weekly:  `Week of ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    monthly: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    yearly:  now.getFullYear().toString(),
  }[briefType] || now.toISOString().split('T')[0];

  const briefId = `${briefType}-${now.toISOString().split('T')[0]}`;
  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Load analyst profile
  let analystProfile = null;
  try {
    const profUrl = userId
      ? `${SUPABASE_URL}/rest/v1/analyst_profiles?user_id=eq.${userId}&limit=1`
      : `${SUPABASE_URL}/rest/v1/analyst_profiles?id=eq.default&limit=1`;
    const profRes = await fetch(profUrl, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const profRows = await profRes.json();
    if (profRows?.[0]?.data) analystProfile = profRows[0].data;
  } catch(e) {}

  // Load submissions
  let analyzed = [], highPriority = [], historicalContext = '';
  try {
    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc&limit=50`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const subs = await subRes.json();
    if (Array.isArray(subs)) {
      analyzed = subs.filter(s => s.analysis);
      highPriority = analyzed.filter(s => s.analysis?.priority === 'High');
    }
  } catch(e) {}

  if (briefType !== 'daily') {
    try {
      const histRes = await fetch(
        `${SUPABASE_URL}/rest/v1/briefs?type=eq.daily&order=generated_at.desc&limit=5`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const hist = await histRes.json();
      if (Array.isArray(hist) && hist.length) {
        historicalContext = hist.map(b =>
          `[${b.period_label}] Risk:${b.content?.overall_risk} ${(b.content?.overall_assessment||'').slice(0,80)}`
        ).join(' | ');
      }
    } catch(e) {}
  }

  const profileContext = analystProfile
    ? `ANALYST: ${analystProfile.role||''} ${analystProfile.unit||''} ${analystProfile.command||''} AOR:${analystProfile.aor||''} Topics:${(analystProfile.priority_topics||[]).join(',')} Questions:${(analystProfile.key_questions||'').slice(0,150)}`
    : '';

  const subContext = analyzed.length
    ? 'HIGH: ' + highPriority.slice(0,3).map(s => `[${s.date}] ${s.analysis?.category}: ${(s.narrative||'').slice(0,100)}`).join(' | ')
    : 'No field submissions.';

  const anthropicHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'web-search-2025-03-05',
  };

  // CALL 1: Main brief themes
  const promptThemes = `You are a senior China intelligence analyst. Date: ${today}. Brief type: ${briefType.toUpperCase()}.
${profileContext ? profileContext + '\n' : ''}
Search news: Reuters, AP, Bloomberg, FT, SCMP, Nikkei Asia, Defense News. Also search CSIS, Pacific Forum, Hudson Institute, Wilson Center, CRS for recent China analysis.

FIELD SUBMISSIONS: ${subContext}
${historicalContext ? 'PRIOR BRIEFS: ' + historicalContext : ''}

TECHNOLOGY must cover: semiconductors, space, 5G/6G, quantum, biotech, green energy, nuclear, robotics, cyber. NOT just AI.
${briefType !== 'daily' ? 'Emphasize trends over time.' : ''}

Return ONLY raw JSON starting { ending }:
{"overall_assessment":"3-4 sentence executive summary.","overall_risk":"High|Medium|Low","themes":{"economy":{"tldr":"1 sentence.","analysis":"4-5 sentences on trade, GDP, markets, policy.","trends":[{"label":"trend","text":"detailed explanation","direction":"Rising|Falling|Stable|Uncertain"},{"label":"trend2","text":"explanation","direction":"Stable"}],"signals":[{"label":"indicator","value":"specific value","desc":"context"},{"label":"indicator2","value":"value","desc":"context"}],"risk":"High|Medium|Low","field_corroboration":""},"regional":{"tldr":"1 sentence.","analysis":"4-5 sentences on Taiwan, SCS, BRI, diplomacy.","trends":[{"label":"trend","text":"explanation","direction":"Rising|Falling|Stable|Uncertain"},{"label":"trend2","text":"explanation","direction":"Stable"}],"signals":[{"label":"indicator","value":"value","desc":"context"},{"label":"indicator2","value":"value","desc":"context"}],"risk":"High|Medium|Low","field_corroboration":""},"military":{"tldr":"1 sentence.","analysis":"4-5 sentences on PLA, exercises, weapons, posture.","trends":[{"label":"trend","text":"explanation","direction":"Rising"},{"label":"trend2","text":"explanation","direction":"Stable"}],"signals":[{"label":"indicator","value":"value","desc":"context"},{"label":"indicator2","value":"value","desc":"context"}],"risk":"High|Medium|Low","field_corroboration":""},"technology":{"tldr":"1 sentence.","analysis":"4-5 sentences across multiple tech domains.","trends":[{"label":"trend","text":"explanation","direction":"Rising"},{"label":"trend2","text":"explanation","direction":"Stable"}],"signals":[{"label":"indicator","value":"value","desc":"context"},{"label":"indicator2","value":"value","desc":"context"}],"risk":"High|Medium|Low","field_corroboration":""}},"think_tank_sources":[{"org":"org","title":"title","date":"date","url":"url","key_finding":"finding"}],"source_count":{"submissions":${analyzed.length},"high_priority_submissions":${highPriority.length}}}`;

  // CALL 2: Economic indicators
  const promptEcon = `You are a China economic analyst. Date: ${today}. Search for the latest China macroeconomic data and return ONLY raw JSON starting { ending }:
{"search_date":"${now.toISOString().split('T')[0]}","overview":"3 sentences on China macro condition.","indicators":[{"name":"GDP Growth Rate","value":"latest figure","previous":"prior period","trend":"Rising|Falling|Stable|Uncertain","interpretation":"what it means for China economy"},{"name":"Retail Sales","value":"YoY%","previous":"prior","trend":"Rising|Falling|Stable|Uncertain","interpretation":"consumer demand signal"}],"pmi":{"manufacturing":"NBS and Caixin figures","services":"NBS and Caixin figures","interpretation":"what PMI signals about momentum"},"trade":{"exports":"YoY%","imports":"YoY%","surplus":"$X billion","key_partners":"notable partner developments","interpretation":"trade data signal"},"currency":{"usd_cny":"current rate","trend":"Appreciation|Depreciation|Stable","pboc_action":"recent PBOC moves","interpretation":"currency implications"},"real_estate":{"status":"market status","key_developers":"Evergrande Country Garden status","policy_response":"govt measures","interpretation":"property sector impact"},"inflation":{"cpi":"X%","ppi":"X%","interpretation":"inflation dynamics and deflation risk"},"employment":{"urban_unemployment":"X%","youth_unemployment":"X%","interpretation":"labor market and social stability"},"foreign_investment":{"fdi":"latest figure","trend":"Rising|Falling|Stable","interpretation":"business confidence signal"},"debt":{"local_government":"situation","corporate":"stress indicators","household":"outlook","interpretation":"systemic risk assessment"},"forward_indicators":[{"name":"Electricity Consumption","value":"reading","interpretation":"true activity signal"},{"name":"Freight Volume","value":"reading","interpretation":"supply chain signal"}],"overall_assessment":"High|Medium-High|Medium|Medium-Low|Low","overall_assessment_text":"3 sentences on economic health trajectory and key risks."}

IMPORTANT: Return ONLY the JSON object above. Do not wrap it in another object. Start your response with { and end with }.`;

  try {
    // Run both calls in parallel
    const [res1, res2] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
          messages: [{ role: 'user', content: promptThemes }]
        })
      }),
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
          messages: [{ role: 'user', content: promptEcon }]
        })
      })
    ]);

    const [data1, data2] = await Promise.all([res1.json(), res2.json()]);

    function extractJSON(data) {
      const allText = (data.content || [])
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text)
        .join('\n')
        .replace(/```json|```/g, '')
        .trim();
      const first = allText.indexOf('{');
      const last = allText.lastIndexOf('}');
      if (first === -1 || last === -1) return null;
      let jsonStr = allText.slice(first, last + 1);
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(jsonStr); } catch(e) { return null; }
    }

    const themes = extractJSON(data1);
    const econ = extractJSON(data2);

    if (!themes) throw new Error('Could not parse themes JSON from AI response');

    const briefContent = { ...themes };
    if (econ) {
      // econ might be the full object or nested under a key
      if (econ.overview || econ.pmi || econ.trade) {
        briefContent.economic_indicators = econ;
      } else if (econ.economic_indicators) {
        briefContent.economic_indicators = econ.economic_indicators;
      }
    }

    // Add tailored section if profile exists
    if (analystProfile) {
      briefContent.tailored_section = {
        role_relevance: `Brief tailored for ${analystProfile.role || 'analyst'} at ${analystProfile.unit || analystProfile.command || 'your organization'}.`,
        priority_topic_highlights: [],
        recommended_actions: []
      };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/briefs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: briefId,
        type: briefType,
        period_label: periodLabel,
        generated_at: now.toISOString(),
        content: briefContent
      })
    });

    return res.status(200).json({ success: true, briefId, type: briefType, period_label: periodLabel });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
