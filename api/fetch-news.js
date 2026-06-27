module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const now = new Date();
  const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateStr = now.toISOString().split('T')[0];

  const HEADERS = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'web-search-2025-03-05',
  };

  const BASE_BODY = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  };

  const SOURCES = `Draw from BOTH Chinese and international sources:
- Chinese state media: Xinhua, Global Times, People's Daily, CGTN, China Daily
- Western/global news: Reuters, AP, Bloomberg, FT, WSJ, SCMP, Nikkei Asia, BBC, The Economist
- Defense/security: Defense News, Breaking Defense, USNI News, Jane's, Military Times
- Think tanks (search for publications from past 30 days): CSIS (csis.org), RAND, IISS, CNAS, Pacific Forum (pacforum.org), Hudson Institute (hudsoninstitute.org), Wilson Center (wilsoncenter.org), CRS (crs.congress.gov), Brookings, CSBA`;

  function buildPrompt(categories) {
    return `Today is ${today}. You are a China intelligence analyst supporting US DoD strategy.

Search for the 4 most significant developments TODAY in each of these categories: ${categories.join(', ')}.

${SOURCES}

For each story note whether it comes from Chinese state media or independent/Western sources — this matters for assessing narrative vs. ground truth.

Return ONLY a raw JSON object. No markdown. Start with { end with }:
{
  "${categories[0]}": [
    {
      "headline": "Concise headline",
      "summary": "2-3 sentence summary including DoD/strategic significance",
      "source": "Publication name",
      "source_type": "Chinese State Media | Western Media | Think Tank | Defense Media",
      "url": "https://url",
      "significance": "High|Medium|Low",
      "think_tank_ref": "Publication title and org if from think tank, else null"
    }
  ],
  "${categories[1]}": []
}`;
  }

  try {
    const [r1, r2] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ ...BASE_BODY, messages: [{ role: 'user', content: buildPrompt(['Politics', 'Military']) }] })
      }),
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ ...BASE_BODY, messages: [{ role: 'user', content: buildPrompt(['Economy', 'Technology']) }] })
      })
    ]);

    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

    function extract(data) {
      const text = (data.content || [])
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text).join('\n')
        .replace(/```json|```/g, '').trim();
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first === -1 || last === -1) return {};
      let s = text.slice(first, last + 1);
      s = s.replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(s); } catch(e) { return {}; }
    }

    const batch1 = extract(d1);
    const batch2 = extract(d2);

    return res.status(200).json({
      date: dateStr,
      generated: now.toISOString(),
      categories: {
        Politics:   batch1.Politics   || [],
        Military:   batch1.Military   || [],
        Economy:    batch2.Economy    || [],
        Technology: batch2.Technology || [],
      }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
