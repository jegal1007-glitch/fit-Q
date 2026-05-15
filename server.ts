import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini
// The key is injected by the AI Studio platform at runtime
const ai = new GoogleGenAI({});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API Routes ---
  
  // Endpoint to generate a mock exam using Gemini
  app.post("/api/generate-exam", async (req, res) => {
    try {
      const { topic, count } = req.body;
      
      if (!topic || !count) {
        return res.status(400).json({ error: "Missing topic or count" });
      }

      const prompt = `You are an expert examiner for professional certification exams (mainly Korean Engineer Certification exams like 정보처리기사, 산업안전기사, etc.).
Generate a mock exam with exactly ${count} multiple-choice questions on the topic of "${topic}".
Important: Korean Engineer Certification exams usually consist of 5 subjects (1과목 to 5과목). 
Distribute the questions evenly across these subjects (e.g., if there are 20 questions, 4 questions for each of the 5 subjects).
If the topic naturally has fewer than 5 subjects, use the appropriate number of subjects.
Each question should be challenging and appropriate for a certification exam.
Ensure there are exactly 4 options for each question.
Provide a clear, brief one-sentence reason for the correct answer in shortExplanation, and a detailed explanation of why the answer is correct and why others are wrong in explanation.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "A unique identifier for the question (e.g., q1, q2...)" },
                text: { type: Type.STRING, description: "The question text" },
                subject: { type: Type.STRING, description: "The exam subject name (e.g., '1과목: 데이터베이스', '2과목: 전자계산기구조', etc.)" },
                options: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "Exactly 4 options for the multiple choice question"
                },
                correctAnswerIndex: { type: Type.INTEGER, description: "The index of the correct option (0, 1, 2, or 3)" },
                shortExplanation: { type: Type.STRING, description: "A one-sentence summary reason for the correct answer" },
                explanation: { type: Type.STRING, description: "Detailed explanation of why the answer is correct and why others are wrong" }
              },
              required: ["id", "text", "subject", "options", "correctAnswerIndex", "shortExplanation", "explanation"]
            }
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Failed to generate content");
      }

      const parsedQuestions = JSON.parse(text);
      const uniqueSessionId = Date.now().toString(36);
      const questions = parsedQuestions.map((q: any, index: number) => ({
        ...q,
        id: `${q.id}_${uniqueSessionId}_${index}`
      }));
      res.json({ questions });
    } catch (error) {
      console.error("Error generating exam:", error);
      res.status(500).json({ error: "Failed to generate mock exam" });
    }
  });

  // --- Vite Middleware (Development) / Static Serving (Production) ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
