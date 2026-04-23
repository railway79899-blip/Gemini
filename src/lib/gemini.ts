import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

let ai: GoogleGenAI;
if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
}

export type MessageRole = 'user' | 'model';

export interface ChatMessage {
  role: MessageRole;
  text: string;
}

export interface GenerationOptions {
  model: string;
  systemInstruction?: string;
  temperature?: number;
  topK?: number;
  topP?: number;
}

export async function* generateChatStream(
  history: ChatMessage[],
  newMessage: string,
  options: GenerationOptions
) {
  if (!ai) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }

  const contents = [
    ...history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    })),
    {
      role: 'user',
      parts: [{ text: newMessage }]
    }
  ];

  const responseStream = await ai.models.generateContentStream({
    model: options.model,
    // @ts-expect-error GenAI SDK types can be picky, but this is the standard multimodal shape
    contents,
    config: {
      systemInstruction: options.systemInstruction || undefined,
      temperature: options.temperature,
      topK: options.topK,
      topP: options.topP,
    }
  });

  for await (const chunk of responseStream) {
    // According to SKILL.md chunk is a GenerateContentResponse
    // @ts-expect-error - cast to any if text property isn't directly on chunk
    yield chunk.text || "";
  }
}
