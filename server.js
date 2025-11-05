// server/server.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config'; // loads .env

const app = express();
const PORT = process.env.PORT || 3000;

// CORS — restrict to your site
const allowed = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/postman
    if (allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400
}));
app.use(express.json({ limit: '1mb' }));

app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [], model = 'gemini-2.5-flash' } = req.body || {};
    const contents = (messages || [])
      .filter(m => m && m.content)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
    while (contents.length && contents[0].role !== 'user') contents.shift();

    const payload = {
      contents,
      systemInstruction: {
        parts: [{ text:
`You are EngiBot, a helpful engineering assistant.
- Be accurate and concise. Show formulas, units, and steps when useful.
- Prefer SI units; convert on request.
- For code, include clear formatting and brief comments.
- Ask for missing data if needed.` }]
      },
      generationConfig: { temperature: 0.2, topP: 0.95, topK: 40, maxOutputTokens: 1200 }
    };

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || `HTTP ${r.status}` });

    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text).join('') || '';
    res.json({ text });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => console.log(`EngiBot proxy running on :${PORT}`));