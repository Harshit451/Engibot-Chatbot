import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Serve your frontend files (HTML, CSS, JS)
app.use(express.static(__dirname));

// ✅ Gemini API Config
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = 'models/gemini-1.5-flash';

// ✅ Chat endpoint
app.post('/api/chat', async (req, res) => {
  console.log("✅ Received message from frontend:", req.body);
  try {
    const { messages } = req.body;

    const url = `https://generativelanguage.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
    const body = {
      contents: messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      })),
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1000,
      },
    };

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

    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    res.json({ reply: reply.trim() });
  } catch (error) {
    console.error('❌ Server error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// ✅ Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
