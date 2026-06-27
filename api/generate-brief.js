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

  const prompt = `You are a senior China intelligence analyst writing a ${briefType.toUpperCase()} brief for US Air Force and DoD. Date: ${today}.

NEWS (Chinese state media + Western + think tanks):
${newsBlock || 'Use training knowledge.'}

FIELD REPORTS (high priority): ${subCtx}

STRICT LENGTH RULES — follow exactly or the output will be truncated:
- executive_assessment: exactly 4 sentences
- each theme analysis: exactly 3 sentences
- each theme dod_implications: exactly 2 sentences
- trends: exactly 1 per theme
- signals: exactly 1 per theme
- think_tank_highlights: exactly 1 entry
- All text values must be concise and specific

Technology themes must cover: semiconductors, space, hypersonics, cyber, quantum, biotech, green/nuclear energy, robotics — not just AI.
${briefType !== 'daily' ? 'Emphasize trends over time.' : ''}

Return ONLY raw JSON starting { ending }:
{"executive_assessment":"Sentence 1. Sentence 2. Sentence 3. Sentence 4.","overall_risk":"High|Medium|Low","key_judgments":["Most important strategic judgment.","Second judgment.","Third judgment."],"themes":{"economy":{"tldr":"One sentence with DoD relevance.","analysis":"Sentence 1 on trade/coercion. Sentence 2 on defense spending capacity. Sentence 3 on supply chain/sanctions.","dod_implications":"Sentence 1 for DoD planning. Sentence 2 on implications.","trends":[{"label":"Trend name","text":"Explanation with evidence and significance.","direction":"Rising|Falling|Stable|Uncertain"}],"signals":[{"label":"Indicator","value":"Specific value","desc":"Strategic context"}],"risk":"High|Medium|Low","field_corroboration":""},"regional":{"tldr":"One sentence.","analysis":"Sentence 1 on Taiwan/SCS. Sentence 2 on BRI/diplomacy. Sentence 3 on influence operations.","dod_implications":"Sentence 1 INDOPACOM. Sentence 2 basing/allies.","trends":[{"label":"Trend name","text":"Explanation.","direction":"Rising|Falling|Stable|Uncertain"}],"signals":[{"label":"Indicator","value":"Value","desc":"Context"}],"risk":"High|Medium|Low","field_corroboration":""},"military":{"tldr":"One sentence.","analysis":"Sentence 1 on PLA modernization. Sentence 2 on exercises/readiness. Sentence 3 on A2AD/nuclear.","dod_implications":"Sentence 1 for USAF ops. Sentence 2 on deterrence.","trends":[{"label":"Trend name","text":"Explanation.","direction":"Rising|Falling|Stable|Uncertain"}],"signals":[{"label":"Indicator","value":"Value","desc":"Context"}],"risk":"High|Medium|Low","field_corroboration":""},"technology":{"tldr":"One sentence.","analysis":"Sentence 1 on semiconductors/space/hypersonics. Sentence 2 on cyber/quantum/biotech. Sentence 3 on dual-use implications.","dod_implications":"Sentence 1 on US tech advantage. Sentence 2 on acquisition/export controls.","trends":[{"label":"Trend name","text":"Explanation.","direction":"Rising|Falling|Stable|Uncertain"}],"signals":[{"label":"Indicator","value":"Value","desc":"Context"}],"risk":"High|Medium|Low","field_corroboration":""}},"think_tank_highlights":[{"org":"Organization","title":"Publication title","key_finding":"Most relevant finding for DoD.","url":null}],"source_count":{"submissions":${analyzed.length},"high_priority":${highPri.length}}}`;

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
