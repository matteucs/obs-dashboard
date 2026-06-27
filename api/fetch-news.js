module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateStr = new Date().toISOString().split('T')[0];
  const isoStr = new Date().toISOString();

  async function fetchBatch(categories) {
    const prompt = 'Today is ' + today + '. Search for 3 of the most important China news stories today in EACH of these categories: ' + categories.join(', ') + '. For Technology include semiconductors, space, 5G, quantum, biotech, green energy, nuclear, robotics, cyber. Return ONLY raw JSON starting with { ending with }: {"categories":{"' + categories[0] + '":[{"headline":"string","summary":"1-2 sentences","source":"string","url":"string","significance":"High|Medium|Low"}],"' + categories[1] + '":[{"headline":"string","summary":"string","source":"string","url":"string","significance":"High|Medium|Low"}]}}';

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
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    const allText = (aiData.content || [])
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

  try {
    const [batch1, batch2] = await Promise.all([
      fetchBatch(['Politics', 'Military']),
      fetchBatch(['Technology', 'Economy'])
    ]);

    return res.status(200).json({
      date: dateStr,
      generated: isoStr,
      categories: {
        Politics:   batch1?.categories?.Politics   || [],
        Military:   batch1?.categories?.Military   || [],
        Technology: batch2?.categories?.Technology || [],
        Economy:    batch2?.categories?.Economy    || [],
      }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
