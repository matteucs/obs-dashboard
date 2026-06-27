module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const now     = new Date();
  const today   = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const dateStr = now.toISOString().split('T')[0];

  const prompt = 'China economic analyst for US DoD. Date: ' + today + '. Provide the latest available China macroeconomic data with specific figures. Keep all text values concise (under 80 characters). Return ONLY raw JSON starting { ending }: {"search_date":"' + dateStr + '","overview":"3 sentences on China macro condition and trajectory.","dod_relevance":"2 sentences on defense spending capacity and military modernization.","indicators":[{"name":"GDP Growth","value":"X%","previous":"X%","trend":"Rising|Falling|Stable|Uncertain","interpretation":"1 sentence"},{"name":"Defense Budget","value":"$X billion","previous":"prior year","trend":"Rising","interpretation":"1 sentence"},{"name":"Retail Sales","value":"YoY X%","previous":"prior","trend":"Rising|Falling|Stable|Uncertain","interpretation":"1 sentence"}],"pmi":{"manufacturing":"NBS X.X Caixin X.X","services":"NBS X.X Caixin X.X","interpretation":"1 sentence"},"trade":{"exports":"YoY X%","imports":"YoY X%","surplus":"$X bn","key_partners":"key developments","interpretation":"1 sentence"},"currency":{"usd_cny":"X.XX","trend":"Appreciation|Depreciation|Stable","pboc_action":"recent action","interpretation":"1 sentence"},"real_estate":{"status":"brief status","key_developers":"Evergrande/Country Garden/Vanke","policy_response":"measures","interpretation":"1 sentence"},"inflation":{"cpi":"X%","ppi":"X%","interpretation":"1 sentence"},"employment":{"urban_unemployment":"X%","youth_unemployment":"X%","interpretation":"1 sentence"},"foreign_investment":{"fdi":"$X billion","trend":"Rising|Falling|Stable","interpretation":"1 sentence"},"debt":{"local_government":"LGFV situation","corporate":"stress level","household":"outlook","interpretation":"1 sentence"},"forward_indicators":[{"name":"Electricity Consumption","value":"YoY X%","interpretation":"1 sentence"},{"name":"Rail Freight","value":"YoY X%","interpretation":"1 sentence"},{"name":"Property Investment","value":"YoY X%","interpretation":"1 sentence"}],"overall_assessment":"High|Medium-High|Medium|Medium-Low|Low","overall_assessment_text":"2-3 sentences on economic health and military modernization capacity."}';

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
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await r.json();
    const raw  = (data.content||[]).filter(b=>b.type==='text'&&b.text).map(b=>b.text).join('\n').trim();
    const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
    if (first === -1 || last === -1) throw new Error('No JSON in response. stop_reason: ' + data.stop_reason);

    let s = raw.slice(first, last+1).replace(/,\s*([}\]])/g,'$1');

    // Try parsing — if it fails walk back to last valid }
    let econ;
    try {
      econ = JSON.parse(s);
    } catch(e1) {
      let parsed = null;
      for (let i = s.length-1; i > 0; i--) {
        if (s[i] === '}') {
          try { parsed = JSON.parse(s.slice(0, i+1)); break; } catch(e2) { continue; }
        }
      }
      if (!parsed) throw new Error('Invalid JSON: ' + e1.message);
      econ = parsed;
    }

    return res.status(200).json(econ);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
