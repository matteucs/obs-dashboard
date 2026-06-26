module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const briefType = req.query.type || 'daily';
  const now = new Date();
  const briefId = `${briefType}-${now.toISOString().split('T')[0]}`;
  const periodLabel = {
    daily:   now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
    weekly:  `Week of ${now.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}`,
    monthly: now.toLocaleDateString('en-US', { month:'long', year:'numeric' }),
    yearly:  now.getFullYear().toString(),
  }[briefType] || now.toISOString().split('T')[0];

  const prompt = `Write a China intelligence brief for ${now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} covering Economy, Regional Goals, Military, Technology. Return ONLY compact JSON no markdown:
{"overall_assessment":"2 sentences","overall_risk":"High|Medium|Low","themes":{"economy":{"tldr":"1 sentence","analysis":"2 sentences","trends":[{"label":"x","text":"x","direction":"Rising"}],"signals":[{"label":"x","value":"x","desc":"x"}],"risk":"Medium","field_corroboration":""},"regional":{"tldr":"x","analysis":"x","trends":[{"label":"x","text":"x","direction":"Stable"}],"signals":[{"label":"x","value":"x","desc":"x"}],"risk":"Medium","field_corroboration":""},"military":{"tldr":"x","analysis":"x","trends":[{"label":"x","text":"x","direction":"Rising"}],"signals":[{"label":"x","value":"x","desc":"x"}],"risk":"High","field_corroboration":""},"technology":{"tldr":"x","analysis":"x","trends":[{"label":"x","text":"x","direction":"Rising"}],"signals":[{"label":"x","value":"x","desc":"x"}],"risk":"Medium","field_corroboration":""}},"source_count":{"submissions":0,"high_priority_submissions":0}}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 3000,
        system: 'You are a China analyst. Always return complete, valid JSON. Keep all text values under 100 characters. Never truncate the response.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    const raw = (aiData.content?.[0]?.text || '').trim().replace(/```json|```/g, '').trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1) throw new Error('No JSON: ' + raw.slice(0,200));

    let jsonStr = raw.slice(first, last + 1);

    // Fix common Claude JSON issues
    // 1. Remove trailing commas before } or ]
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    // 2. Fix unescaped quotes inside strings (basic fix)
    // 3. Truncate at last valid closing brace if parse fails
    let briefContent;
    try {
      briefContent = JSON.parse(jsonStr);
    } catch(e1) {
      // Try progressively shorter strings until valid
      let validJson = null;
      for (let i = jsonStr.length - 1; i > 0; i--) {
        if (jsonStr[i] === '}') {
          try {
            const candidate = jsonStr.slice(0, i + 1);
            validJson = JSON.parse(candidate);
            break;
          } catch(e2) { continue; }
        }
      }
      if (!validJson) throw new Error('Invalid JSON: ' + e1.message);
      briefContent = validJson;
    }

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
