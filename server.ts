/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK with telemetry header
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
  try {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    console.log('Gemini API initialized successfully on backend.');
  } catch (error) {
    console.error('Error initializing Gemini SDK:', error);
  }
} else {
  console.warn('GEMINI_API_KEY environment variable is not defined or is placeholder.');
}

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    aiAvailable: !!ai,
    environment: process.env.NODE_ENV || 'development'
  });
});

/**
 * Endpoint to generate rain holiday alerts, homework details, and online test questions.
 */
app.post('/api/gemini/generate', async (req, res) => {
  const { type, subject, gradeClass, topic, weatherSeverity, schoolLocation } = req.body;

  if (!ai) {
    return res.status(503).json({ 
      error: 'AI Generation Service is currently unavailable. (Missing or invalid GEMINI_API_KEY)' 
    });
  }

  try {
    let prompt = '';
    let responseSchema: any = null;

    if (type === 'rain_holiday_notice') {
      prompt = `Generate a clear, friendly, and reassuring emergency rain holiday notice for elementary school parents.
Grade level: ${gradeClass || 'All Elementary Grades'}
School Location/Area: ${schoolLocation || 'District School Area'}
Weather conditions: ${weatherSeverity || 'Heavy rainfall and local flooding forecast'}
Include the date of closure, safety advice, and a reminder that online homework or optional activities will be posted. Ensure the tone is empathetic and highly clear for parents with limited technical experience. Provide only the text for the notice.`;
    } else if (type === 'draft_health_alert') {
      const { studentName, symptoms, temperature } = req.body;
      prompt = `Create a warm, caring, yet clear emergency health notification to be sent to a parent about their child who is sick at school.
Student Name: ${studentName || 'the student'}
Symptoms: ${Array.isArray(symptoms) ? symptoms.join(', ') : (symptoms || 'fever')}
Temperature: ${temperature || 'not measured'}
The message should inform the parent that their child is not feeling well, briefly list the symptoms, and gently request them to collect their child from the school and take good care of them. Keep it short, empathetic, polite, and reassuring. Output only the message body.`;
    } else if (type === 'generate_homework') {
      prompt = `Create a creative, highly structured homework assignment for elementary school students.
Subject: ${subject || 'General'}
Grade Level: ${gradeClass || 'Grade 3'}
Topic: ${topic || 'Creative Learning'}
Include:
1. A kid-friendly title.
2. A brief, fun introduction or lesson text (approx 2-3 sentences).
3. 3 small tasks or questions appropriate for elementary students.
4. Tips for parents on how they can guide their child.
Ensure the layout uses bullet points and is clear.`;
    } else if (type === 'generate_test_questions') {
      prompt = `Generate exactly 5 high-quality, elementary-level multiple-choice questions for an online test.
Subject: ${subject || 'Math'}
Grade Level: ${gradeClass || 'Grade 3'}
Topic: ${topic || 'General Knowledge'}

Provide the questions in a strict JSON list format conforming to this schema. Ensure difficulty matches elementary students.`;
      
      responseSchema = {
        type: Type.ARRAY,
        description: "List of 5 test questions",
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: "Unique generated ID (e.g. q1, q2)" },
            text: { type: Type.STRING, description: "The clear, readable question text" },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Four multiple choice options"
            },
            correctAnswerIndex: { 
              type: Type.INTEGER, 
              description: "0-based index of the correct option in the options array" 
            }
          },
          required: ["id", "text", "options", "correctAnswerIndex"]
        }
      };
    } else if (type === 'translate_text') {
      const { text, targetLanguage } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Text is required for translation.' });
      }
      prompt = `You are a professional translator for a bilingual Tamil-English elementary school portal. Translate the following text into ${targetLanguage === 'ta' ? 'Tamil' : 'English'}. Keep the translation natural, beautiful, warm, and highly accurate. Avoid any extra commentary. Output only the translated text.\n\nText:\n${text}`;
    } else if (type === 'generate_news_bilingual') {
      const { topic: newsTopic, category: newsCategory } = req.body;
      prompt = `Create a lively, engaging elementary school news article or notification update for the topic: "${newsTopic || 'School News'}".
Category of update: ${newsCategory || 'General'}.
Generate the article's title and body in both English and Tamil.
Ensure the Tamil content is grammatically precise, rich, and completely natural for Tamil-speaking parents and children.

Conform to this strict JSON schema.`;

      responseSchema = {
        type: Type.OBJECT,
        properties: {
          titleEn: { type: Type.STRING, description: "Engaging headline in English" },
          titleTa: { type: Type.STRING, description: "Engaging headline in Tamil" },
          contentEn: { type: Type.STRING, description: "Article content in English (1-2 paragraphs, professional and warm)" },
          contentTa: { type: Type.STRING, description: "Article content in Tamil (match the English structure perfectly)" },
          category: { type: Type.STRING, description: "Selected category matching the input category" }
        },
        required: ["titleEn", "titleTa", "contentEn", "contentTa", "category"]
      };
    } else {
      return res.status(400).json({ error: 'Invalid generation type requested.' });
    }

    console.log(`Sending prompt to Gemini [Type: ${type}]...`);

    const config: any = {
      systemInstruction: "You are an expert, friendly elementary school principal and teacher helper, skilled at writing extremely clear, warm communications for parents and age-appropriate quizzes and worksheets for students.",
    };

    if (responseSchema) {
      config.responseMimeType = "application/json";
      config.responseSchema = responseSchema;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config,
    });

    const resultText = response.text || '';
    
    if (responseSchema) {
      try {
        const parsedData = JSON.parse(resultText.trim());
        return res.json({ result: parsedData });
      } catch (err) {
        console.error('Failed to parse schema JSON from Gemini:', err);
        return res.json({ result: resultText, parseError: true });
      }
    }

    return res.json({ result: resultText });

  } catch (error: any) {
    console.error('Gemini content generation error:', error);
    return res.status(500).json({ error: error.message || 'Error occurred during AI generation' });
  }
});

// Configure development or production asset serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware mounted for development.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Serving production static assets.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
