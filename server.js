import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(".")); // serve index.html and JS files

const PORT = 3000;

// ✅ Gemini API endpoint
app.post("/api/chat", async (req, res) => {
  try {
    console.log("✅ Received message from frontend:", req.body);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("❌ No Gemini API key found in .env");
      return res.status(500).json({ error: "Missing API key" });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: req.body.messages.map((msg) => ({
            role: msg.role,
            parts: [{ text: msg.content }],
          })),
        }),
      }
    );

    const data = await response.json();
    console.log("🔹 Gemini API full response:", data);

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn’t process that right now.";
    res.json({ reply });
  } catch (error) {
    console.error("❌ Server error:", error);
    res.status(500).json({ error: "Server failed to process request" });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
