import { GoogleGenAI } from '@google/genai';
import textToSpeech from '@google-cloud/text-to-speech';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import {
  CareConfig,
  ParsedScheduleResponse,
  ParsedScheduleResponseSchema,
} from './schemas';

const MAX_AUDIO_CACHE_ENTRIES = 150;
const memoryAudioCache = new Map<string, Buffer>();
let sharedTtsClient: InstanceType<typeof textToSpeech.TextToSpeechClient> | null = null;

function setAudioCache(key: string, buf: Buffer): void {
  if (memoryAudioCache.size >= MAX_AUDIO_CACHE_ENTRIES) {
    const oldestKey = memoryAudioCache.keys().next().value;
    if (oldestKey) {
      memoryAudioCache.delete(oldestKey);
    }
  }
  memoryAudioCache.set(key, buf);
}

function getTtsClient() {
  if (!sharedTtsClient) {
    sharedTtsClient = new textToSpeech.TextToSpeechClient();
  }
  return sharedTtsClient;
}

/**
 * Synthesizes 100% Native Urdu text (Nastaliq script, e.g. "السلام علیکم امی...")
 * into a crystal-clear MP3 buffer using Google Cloud Text-to-Speech WaveNet (ur-IN-Wavenet-A).
 * Cached in memory so repeat plays on phone calls or Telegram take <5ms and cost $0.
 */
export async function synthesizeNativeUrduMp3Buffer(
  urduNativeText: string,
  voiceName = 'ur-PK-Standard-A'
): Promise<Buffer> {
  const cacheKey = `${voiceName}:${urduNativeText}`;
  const cached = memoryAudioCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const ttsClient = getTtsClient();
  const languageCode = /^[a-z]{2}-[A-Z]{2}/.test(voiceName)
    ? voiceName.slice(0, 5)
    : 'ur-PK';

  try {
    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: urduNativeText },
      voice: {
        languageCode,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 0.90,
        pitch: 0.0,
      },
    });

    if (ttsResponse.audioContent) {
      const buf = Buffer.from(ttsResponse.audioContent as Uint8Array);
      setAudioCache(cacheKey, buf);
      return buf;
    }
  } catch {
    // Fallback to standard ur-IN voice if specific Wavenet voice name differs in region
    const [fallbackResp] = await ttsClient.synthesizeSpeech({
      input: { text: urduNativeText },
      voice: {
        languageCode: 'ur-IN',
        ssmlGender: 'FEMALE',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 0.90,
      },
    });
    if (fallbackResp.audioContent) {
      const buf = Buffer.from(fallbackResp.audioContent as Uint8Array);
      setAudioCache(cacheKey, buf);
      return buf;
    }
  }

  throw new Error('Failed to synthesize Urdu MP3 via Google Cloud Text-to-Speech.');
}

/**
 * Uses @google/genai (gemini-2.5-flash) with Zod Structured Output to parse
 * a natural language routine or hospital discharge prescription image.
 */
export async function parseScheduleWithGemini(
  naturalText: string,
  config: CareConfig,
  imageBase64?: { data: string; mimeType: string }
): Promise<ParsedScheduleResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const jsonSchema = z.toJSONSchema(ParsedScheduleResponseSchema);

  const systemInstruction = `You are an expert medical care coordinator for "${config.appName}".
Convert the daily routine into structured tasks for "${config.patientTitle}" (patient), managed by "${config.caregiverTitle}" (primary caregiver), with escalation to "${config.escalationName}".
- Use FIXED_TIME for clock-scheduled meals/tasks and AFTER_TASK (with parentTemplateId and offsetMinutes) for meal-dependent medicines or snacks (e.g. +15m medicines after breakfast, +120m boiled eggs after breakfast).
- Write warm, respectful Pakistani Urdu scripts in both Roman Urdu (urduScript) and Nastaliq Urdu (urduScriptNative) instructing ${config.caregiverTitle} using WhatsApp reply phrasing ("جواب میں 1 لکھ کر بھیجیں" / "jawab mein 1 likh kar bhejein", NOT "دبائیں"): Reply 1 when done, Reply 2 ("2 لکھ کر بھیجیں") to snooze ${config.snoozeDurationMinutes}m, Reply 3 ("3 لکھ کر بھیجیں") if ${config.patientTitle} is refusing so ${config.escalationName} is immediately notified ("تاکہ ${config.escalationName} کو فوری اطلاع مل جائے").`;

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: naturalText },
  ];

  if (imageBase64) {
    parts.push({ inlineData: imageBase64 });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
      temperature: 0.2,
    },
  });

  if (!response.text) {
    throw new Error('No structured JSON returned from Gemini 2.5 Flash.');
  }

  return ParsedScheduleResponseSchema.parse(JSON.parse(response.text));
}

/**
 * Synthesizes Urdu voice prompt and caches it in Firebase Cloud Storage.
 */
export async function synthesizeAndCacheTaskAudio(
  templateId: string,
  scriptText: string,
  config: CareConfig
): Promise<string> {
  const bucket = admin.storage().bucket();
  const filePath = `audio/${templateId}_${config.language}.mp3`;
  const file = bucket.file(filePath);

  const mp3Buffer = await synthesizeNativeUrduMp3Buffer(
    scriptText,
    config.voiceName || 'ur-IN-Wavenet-A'
  );

  await file.save(mp3Buffer, {
    contentType: 'audio/mpeg',
    public: true,
  });

  return file.publicUrl();
}
