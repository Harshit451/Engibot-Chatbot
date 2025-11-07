import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const SYSTEM_PROMPT = `You are EngiBot, a helpful engineering assistant.
- Be accurate and concise. Show formulas, units, and steps when useful.
- Prefer SI units; convert on request.
- For code, include clear formatting and brief comments.
- Ask for missing data if needed.`;

const app = express();
app.use(express.json());
app.use(express.static('.'));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

app.post('/api/chat', async (req, res) => {
  console.log("✅ Received message from frontend:", req.body);

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'No Gemini API key found in .env' });
  }

  try {
    const { messages } = req.body;

 const body = {
  contents: messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'system',
    parts: [{ text: m.content || m.text || "" }]   // ✅ parts array is required
  })),
  temperature: 0.2,
  maxOutputTokens: 1000
};





    const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: errorData.error || 'Unknown error' });
    }

    const data = await response.json();
    console.log("🔹 Gemini API full response:", JSON.stringify(data, null, 2));

    const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('')
                  || data?.candidates?.[0]?.content?.text
                  || 'Sorry, no reply received.';

    res.json({ reply: reply.trim() });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
