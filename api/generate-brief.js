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
  let submissions = [];
  try {
    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/submissions?order=created_at.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    submissions = await subRes.json();
  } catch(e) {}

  const cutoff = {
    daily:   new Date(now - 1   * 24 * 60 * 60 * 1000),
    weekly:  new Date(now - 7   * 24 * 60 * 60 * 1000),
    monthly: new Date(now - 30  * 24 * 60 * 60 * 1000),
    yearly:  new Date(now - 365 * 24 * 60 * 60 * 1000),
  }[briefType];

  const filtered = briefType === 'daily' ? submissions : submissions.filter(s => new Date(s.created_at) >= cutoff);
  const analyzed = filtered.filter(s => s.analysis);
  const highPriority = analyzed.filter(s => s.analysis?.priority === 'High');
  const medPriority  = analyzed.filter(s => s.analysis?.priority === 'Medium');

  const fmtSub = s => `[${s.date}] ${s.analysis?.category}: ${(s.narrative||'').slice(0,100)}`;

  const subContext = analyzed.length
    ? `HIGH (${highPriority.length}): ${highPriority.map(fmtSub).join(' | ')} MED (${medPriority.length}): ${medPriority.map(fmtSub).join(' | ')}`
    : 'No analyzed submissions.';

  // Historical context
  let historicalContext = '';
  if (briefType !== 'daily') {
    try {
      const histRes = await fetch(
        `${SUPABASE_URL}/rest/v1/briefs?type=eq.daily&order=generated_at.desc&limit=5`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const hist = await histRes.json();
      if (hist.length) {
        historicalContext = hist.map(b =>
          `[${b.period_label}] Risk:${b.content?.overall_risk} ${(b.content?.overall_assessment||'').slice(0,80)}`
        ).join(' | ');
      }
    } catch(e) {}
  }

  // Profile tailoring
  const profileContext = analystProfile ? `ANALYST: ${analystProfile.role||''} ${analystProfile.unit||''} ${analystProfile.command||''} AOR:${analystProfile.aor||''} Topics:${(analystProfile.priority_topics||[]).join(',')} Questions:${(analystProfile.key_questions||'').slice(0,200)}` : '';

  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `You are a senior China intelligence analyst. Date: ${today}. Type: ${briefType.toUpperCase()}.
${profileContext ? profileContext + '\n' : ''}
Search for today's China news and think tank analysis (CSIS, Pacific Forum, Hudson, Wilson Center, CRS). Use field submissions as corroborating signal.

FIELD SUBMISSIONS: ${subContext}
${historicalContext ? 'PRIOR BRIEFS: ' + historicalContext : ''}

Technology coverage must be BROAD: semiconductors, space, 5G/6G, quantum, biotech, green energy, nuclear, robotics, cyber — not just AI.
${briefType !== 'daily' ? 'Emphasize trends over time.' : ''}

Return ONLY raw JSON, no markdown:
{
  "overall_assessment": "3-4 sentence executive summary.",
  "overall_risk": "High|Medium|Low",
  "themes": {
    "economy":    {"tldr":"...","analysis":"3-4 sentences.","trends":[{"label":"...","text":"...","direction":"Rising|Falling|Stable|Uncertain"}],"signals":[{"label":"...","value":"...","desc":"..."}],"risk":"High|Medium|Low","field_corroboration":"..."},
    "regional":   {"tldr":"...","analysis":"...","trends":[...],"signals":[...],"risk":"...","field_corroboration":"..."},
    "military":   {"tldr":"...","analysis":"...","trends":[...],"signals":[...],"risk":"...","field_corroboration":"..."},
    "technology": {"tldr":"...","analysis":"...","trends":[...],"signals":[...],"risk":"...","field_corroboration":"..."}
  },
  "think_tank_sources": [{"org":"...","title":"...","date":"...","url":"...","key_finding":"..."}],
  "tailored_section": {"role_relevance":"...","priority_topic_highlights":[{"topic":"...","finding":"...","implication":"..."}],"recommended_actions":["..."]},
  "economic_indicators": {
    "search_date": "${now.toISOString().split('T')[0]}",
    "overview": "2-3 sentence macro summary.",
    "indicators": [{"name":"GDP Growth","value":"...","previous":"...","trend":"Rising|Falling|Stable|Uncertain","interpretation":"..."}],
    "pmi": {"manufacturing":"...","services":"...","interpretation":"..."},
    "trade": {"exports":"...","imports":"...","surplus":"...","key_partners":"...","interpretation":"..."},
    "currency": {"usd_cny":"...","trend":"Appreciation|Depreciation|Stable","pboc_action":"...","interpretation":"..."},
    "real_estate": {"status":"...","key_developers":"...","policy_response":"...","interpretation":"..."},
    "inflation": {"cpi":"...","ppi":"...","interpretation":"..."},
    "employment": {"urban_unemployment":"...","youth_unemployment":"...","interpretation":"..."},
    "foreign_investment": {"fdi":"...","trend":"Rising|Falling|Stable","interpretation":"..."},
    "debt": {"local_government":"...","corporate":"...","household":"...","interpretation":"..."},
    "forward_indicators": [{"name":"...","value":"...","interpretation":"..."}],
    "overall_assessment": "High|Medium-High|Medium|Medium-Low|Low",
    "overall_assessment_text": "2-3 sentence bottom line."
  },
  "source_count": {"submissions": ${analyzed.length}, "high_priority_submissions": ${highPriority.length}}
}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 5000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    let jsonText = null;

    const allText = (aiData.content || [])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text)
      .join('\n');

    if (allText) {
      const cleaned = allText.trim().replace(/```json|```/g, '').trim();
      try { JSON.parse(cleaned); jsonText = cleaned; } catch(e) {}
      if (!jsonText) {
        const first = cleaned.indexOf('{');
        const last = cleaned.lastIndexOf('}');
        if (first !== -1 && last > first) {
          try { JSON.parse(cleaned.slice(first, last + 1)); jsonText = cleaned.slice(first, last + 1); } catch(e) {}
        }
      }
    }

    if (!jsonText) {
      const preview = (aiData.content||[]).map(b => b.type + (b.type==='text' ? ':' + (b.text||'').slice(0,100) : '')).join(' | ');
      throw new Error('No valid JSON. Got: ' + preview.slice(0,300));
    }

    const briefContent = JSON.parse(jsonText);

    await fetch(`${SUPABASE_URL}/rest/v1/briefs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: briefId, type: briefType, period_label: periodLabel, generated_at: now.toISOString(), content: briefContent })
    });

    return res.status(200).json({ success: true, briefId, type: briefType, period_label: periodLabel });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
