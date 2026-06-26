module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  const briefType = req.query.type || 'daily';
  const now = new Date();

  const periodLabel = {
    daily:   now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    weekly:  `Week of ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    monthly: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    yearly:  now.getFullYear().toString(),
  }[briefType] || now.toISOString().split('T')[0];

  const briefId = `${briefType}-${now.toISOString().split('T')[0]}`;
  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Minimal prompt - no Supabase lookups, no web search, just generate
  const prompt = `You are a senior China intelligence analyst. Date: ${today}. Generate a ${briefType} intelligence brief on China.

Cover Economy, Regional Goals, Military, and Technology (semiconductors, space, 5G, quantum, biotech, green energy, nuclear, robotics, cyber - not just AI).

Return ONLY this raw JSON with no markdown fences:
{"overall_assessment":"3 sentence executive summary.","overall_risk":"High|Medium|Low","themes":{"economy":{"tldr":"one sentence.","analysis":"3 sentences.","trends":[{"label":"trend name","text":"description","direction":"Rising|Falling|Stable|Uncertain"}],"signals":[{"label":"indicator","value":"value","desc":"context"}],"risk":"High|Medium|Low","field_corroboration":""},"regional":{"tldr":"...","analysis":"...","trends":[{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."}],"risk":"...","field_corroboration":""},"military":{"tldr":"...","analysis":"...","trends":[{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."}],"risk":"...","field_corroboration":""},"technology":{"tldr":"...","analysis":"...","trends":[{"label":"...","text":"...","direction":"..."}],"signals":[{"label":"...","value":"...","desc":"..."}],"risk":"...","field_corroboration":""}},"source_count":{"submissions":0,"high_priority_submissions":0}}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    const raw = (aiData.content?.[0]?.text || '').trim().replace(/```json|```/g, '').trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1) throw new Error('No JSON in response: ' + raw.slice(0, 200));

    const briefContent = JSON.parse(raw.slice(first, last + 1));

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
