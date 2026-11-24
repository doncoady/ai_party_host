import { GoogleGenAI } from '@google/genai';
import { config } from './config.ts';

/**
 * Thin wrapper around the Gemini SDK: text, JSON, TTS, and multimodal audio
 * analysis. Every helper returns null when Gemini is not configured so callers
 * can degrade gracefully (built-in packs, heuristic clip analysis, text host).
 */
let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI | null {
  if (!config.hasGemini) return null;
  client ??= new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: { headers: { 'User-Agent': 'ai-party-host' } },
  });
  return client;
}

export async function generateText(prompt: string, options: { temperature?: number } = {}): Promise<string | null> {
  const ai = gemini();
  if (!ai) return null;
  const response = await ai.models.generateContent({
    model: config.models.text,
    contents: prompt,
    config: { temperature: options.temperature ?? 0.9 },
  });
  return response.text?.trim() || null;
}

export async function generateJson<T>(prompt: string, schema: Record<string, unknown>, options: { temperature?: number; maxOutputTokens?: number; audio?: { data: Buffer; mimeType: string } } = {}): Promise<T | null> {
  const ai = gemini();
  if (!ai) return null;
  const parts: Array<Record<string, unknown>> = [];
  if (options.audio) {
    parts.push({ inlineData: { mimeType: options.audio.mimeType, data: options.audio.data.toString('base64') } });
  }
  parts.push({ text: prompt });
  const response = await ai.models.generateContent({
    model: config.models.text,
    contents: [{ role: 'user', parts }],
    config: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 8192,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });
  const text = response.text?.trim();
  if (!text) return null;
  return JSON.parse(stripCodeFence(text)) as T;
}

function stripCodeFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export async function synthesizeSpeech(text: string, style = config.hostStyle, voice = config.hostVoice): Promise<string | undefined> {
  const ai = gemini();
  if (!ai) return undefined;
  const interaction = await ai.interactions.create({
    model: config.models.tts,
    input: [{
      type: 'user_input',
      content: [{
        type: 'text',
        text,
        annotations: [{ type: 'speech_metadata', style }],
      }],
    }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  });
  return interaction.output_audio?.data;
}
