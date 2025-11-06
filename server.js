// server.js
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('.')); // serve frontend files

// Load Gemini API key from .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Change this to a currently supported Gemini model
const GEMINI_MODEL = 'gemini-2.5-flash';

app.post('/api/chat', async (req, res) => {
  console.log("✅ Received message from frontend:", req.body);

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'No Gemini API key found in .env' });
  }

  try {
    const { messages } = req.body;

    // Convert frontend messages to Gemini API format
    const body = {
    contents: messages.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model', // ✅ 'model' instead of 'assistant'
    parts: [{ text: msg.content }]
    })),
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1000,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log("🔹 Gemini API full response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    res.json({ reply: reply.trim() });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
