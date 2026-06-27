module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateStr = new Date().toISOString().split('T')[0];
  const isoStr = new Date().toISOString();

  const prompt = 'Today is ' + today + '. Search for the most important China news today across Politics, Military, Technology, and Economy. For each category find 4-6 significant stories. For Technology cover semiconductors, space, 5G/6G, quantum computing, biotech, green energy, nuclear, robotics, cybersecurity - not just AI. Return ONLY a raw JSON object starting with { and ending with } using this exact structure: {"date":"' + dateStr + '","generated":"' + isoStr + '","categories":{"Politics":[{"headline":"string","summary":"1-2 sentence summary","source":"source name","url":"https://url","significance":"High|Medium|Low"}],"Military":[{"headline":"string","summary":"string","source":"string","url":"string","significance":"High|Medium|Low"}],"Technology":[{"headline":"string","summary":"string","source":"string","url":"string","significance":"High|Medium|Low"}],"Economy":[{"headline":"string","summary":"string","source":"string","url":"string","significance":"High|Medium|Low"}]}}';

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
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();

    const allText = (aiData.content || [])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text)
      .join('\n')
      .trim()
      .replace(/```json|```/g, '')
      .trim();

    const first = allText.indexOf('{');
    const last = allText.lastIndexOf('}');
    if (first === -1 || last === -1) throw new Error('No JSON in response');

    let jsonStr = allText.slice(first, last + 1);
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    const newsData = JSON.parse(jsonStr);

    return res.status(200).json(newsData);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
