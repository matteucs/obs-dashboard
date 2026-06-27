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

  const prompt = `Senior China analyst. ${today}. ${briefType.toUpperCase()} brief for US Air Force and DoD.

NEWS (Chinese state + Western + think tanks): ${newsBlock || 'Use training knowledge.'}
HIGH PRIORITY FIELD REPORTS: ${subCtx}

Write a focused intelligence brief. Frame all analysis for USAF/DoD strategy. Technology must span: semiconductors, space, 5G/6G, quantum, biotech, green energy, nuclear, hypersonics, robotics, cyber — not just AI. Note where Chinese state media diverges from Western reporting.

Return ONLY raw JSON starting { ending }:
{"executive_assessment":"5 sentences synthesizing critical developments and USAF/DoD implications. Specific about what is accelerating and what requires attention.","overall_risk":"High|Medium|Low","key_judgments":["KJ1: most important judgment","KJ2: second","KJ3: third"],"themes":{"economy":{"tldr":"1 sentence with DoD relevance.","analysis":"4 sentences: trade, economic coercion, defense spending capacity, supply chain vulnerabilities, sanctions effects.","dod_implications":"2 sentences for DoD planning.","trends":[{"label":"name","text":"evidence and significance","direction":"Rising|Falling|Stable|Uncertain"},{"label":"name","text":"explanation","direction":"Stable"}],"signals":[{"label":"indicator","value":"specific value","desc":"context"},{"label":"indicator","value":"value","desc":"context"}],"risk":"High|Medium|Low","field_corroboration":""},"regional":{"tldr":"1 sentence.","analysis":"4 sentences: Taiwan Strait, South China Sea, BRI, diplomacy, influence operations.","dod_implications":"2 sentences: INDOPACOM, basing, allied relationships.","trends":[{"label":"...","text":"...","direction":"..."},{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."},{"label":"...","value":"...","desc":"..."}],"risk":"High|Medium|Low","field_corroboration":""},"military":{"tldr":"1 sentence.","analysis":"4 sentences: PLA modernization, PLAAF/PLAN/PLARF exercises, A2/AD, nuclear posture.","dod_implications":"2 sentences: USAF operations, Kadena/Andersen/Misawa, force planning.","trends":[{"label":"...","text":"...","direction":"..."},{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."},{"label":"...","value":"...","desc":"..."}],"risk":"High|Medium|Low","field_corroboration":""},"technology":{"tldr":"1 sentence.","analysis":"4 sentences across multiple tech domains.","dod_implications":"2 sentences: military advantage, acquisition priorities, export controls.","trends":[{"label":"...","text":"...","direction":"..."},{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."},{"label":"...","value":"...","desc":"..."}],"risk":"High|Medium|Low","field_corroboration":""}},"think_tank_highlights":[{"org":"org","title":"title","key_finding":"DoD-relevant finding","url":null}],"source_count":{"submissions":${analyzed.length},"high_priority":${highPri.length}}}`;

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data  = await r.json();
    const text  = (data.content||[]).filter(b=>b.type==='text'&&b.text).map(b=>b.text).join('\n')
      .replace(/```json|```/g,'').trim();
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    if (first===-1||last===-1) throw new Error('No JSON in response. Stop_reason: ' + data.stop_reason);
    let s = text.slice(first,last+1).replace(/,\s*([}\]])/g,'$1');
    const brief = JSON.parse(s);

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
