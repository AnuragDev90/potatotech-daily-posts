const axios = require("axios");
require("dotenv").config();

async function testOllama() {
  try {
    console.log("🖥️  Testing Ollama...");
    const response = await axios.post(
      "http://localhost:11434/api/generate",
      {
        model: "mistral",
        prompt: "Write a short sentence about iPhone battery",
        stream: false,
      },
      { timeout: 300000 },
    );

    console.log("✅ Ollama works!");
    console.log("Response:", response.data.response.substring(0, 100));
  } catch (error) {
    console.log("❌ Ollama failed:", error.message);
  }
}

async function testGroq() {
  try {
    console.log("\n☁️  Testing Groq...");
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "mixtral-8x7b-32768",
        messages: [
          {
            role: "user",
            content: "Write a short sentence about iPhone battery",
          },
        ],
        max_tokens: 100,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ Groq works!");
    console.log(
      "Response:",
      response.data.choices[0].message.content.substring(0, 100),
    );
  } catch (error) {
    console.log("❌ Groq failed:", error.message);
  }
}

async function main() {
  await testOllama();
  await testGroq();
}

main();
