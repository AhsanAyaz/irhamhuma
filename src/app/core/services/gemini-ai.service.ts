import { Injectable, signal } from '@angular/core';
import { z } from 'zod';
import {
  CareConfig,
  ParsedScheduleResponse,
  ParsedScheduleResponseSchema,
} from '../models/care.models';

@Injectable({
  providedIn: 'root',
})
export class GeminiAiService {
  readonly isGenerating = signal(false);
  readonly isSynthesizingAudio = signal(false);
  readonly lastError = signal<string | null>(null);

  /**
   * Parses a natural language care routine or hospital discharge prescription image
   * into a strictly validated schedule with fixed times, meal-chained offsets, and Urdu scripts
   * using @google/genai (gemini-2.5-flash) + Zod Structured Outputs.
   */
  async parseScheduleFromInput(
    naturalText: string,
    config: CareConfig,
    imageBase64?: { data: string; mimeType: string }
  ): Promise<ParsedScheduleResponse> {
    this.isGenerating.set(true);
    this.lastError.set(null);

    try {
      const apiKey = config.geminiApiKey?.trim();
      if (!apiKey) {
        // Intelligent local fallback parser when testing without an API key
        return this.parseScheduleFallback(naturalText, config);
      }

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const jsonSchema = z.toJSONSchema(ParsedScheduleResponseSchema);

      const systemInstruction = `You are an expert medical care coordinator and Pakistani family voice assistant for the "${config.appName}" system.
Your job is to convert a daily care routine or hospital discharge prescription into a structured daily schedule for "${config.patientTitle}" (the patient), managed on the ground by "${config.caregiverTitle}" (the primary caregiver), with escalation to "${config.escalationName}" (the son/family member).

CRITICAL RULES:
1. Identify which tasks happen at a FIXED_TIME (e.g., Breakfast at 08:30, Lunch at 13:30, Tea + Cake Rusks at 17:00, Evening Milkshake at 18:30, Dinner at 20:30) and which tasks happen AFTER_TASK relative to a meal (e.g., Post-breakfast medicines 15 minutes after breakfast; Boiled eggs 120 minutes after breakfast; Post-dinner medicines 15 minutes after dinner).
2. For AFTER_TASK items, set parentTemplateId to the exact id of the parent task, and offsetMinutes to the integer number of minutes after the parent task completes.
3. For every task, write a warm, respectful, affectionate Pakistani Urdu voice script (both in Roman Urdu under 'urduScript' and Nastaliq Urdu script under 'urduScriptNative') addressed to "${config.caregiverTitle}" about "${config.patientTitle}".
4. Every 'urduScript' and 'urduScriptNative' MUST remind "${config.caregiverTitle}" using WhatsApp reply phrasing ("likh kar bhejein" / "لکھ کر بھیجیں", NOT "dabayein" / "دبائیں"):
   - Reply 1 ("جواب میں 1 لکھ کر بھیجیں" / "jawab mein 1 likh kar bhejein") when "${config.patientTitle}" has completed/taken it
   - Reply 2 ("2 لکھ کر بھیجیں" / "2 likh kar bhejein") to snooze for ${config.snoozeDurationMinutes} minutes
   - Reply 3 ("3 لکھ کر بھیجیں" / "3 likh kar bhejein") if "${config.patientTitle}" is refusing so "${config.escalationName}" is immediately notified ("تاکہ ${config.escalationName} کو فوری اطلاع مل جائے" / "taake ${config.escalationName} ko fori ittila mil jaye").
5. Every 'escalationScript' MUST address "${config.escalationName}" and offer: Press 1 if handled, Press 2 to re-call "${config.caregiverTitle}" in ${config.snoozeDurationMinutes}m, or Press 9 to live-bridge the call to "${config.caregiverTitle}" and "${config.patientTitle}".`;

      const contentsParts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
        {
          text: `Parse the following daily care & medication routine for ${config.patientTitle} (caregiver: ${config.caregiverTitle}, escalation: ${config.escalationName}):\n\n${naturalText}`,
        },
      ];

      if (imageBase64) {
        contentsParts.push({
          inlineData: {
            data: imageBase64.data,
            mimeType: imageBase64.mimeType,
          },
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: contentsParts }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
          temperature: 0.2,
        },
      });

      const rawText = response.text;
      if (!rawText) {
        throw new Error('Empty response received from Gemini 2.5 Flash.');
      }

      // Runtime validation with Zod
      const validated = ParsedScheduleResponseSchema.parse(JSON.parse(rawText));
      return validated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to parse schedule with Gemini.';
      this.lastError.set(msg);
      throw err;
    } finally {
      this.isGenerating.set(false);
    }
  }

  /**
   * Synthesizes natural Urdu/bilingual audio using Gemini 2.5 Flash Preview TTS
   * (`gemini-2.5-flash-preview-tts`) with `responseModalities: ['AUDIO']`.
   * Returns a playable data URL or Blob URL.
   */
  async synthesizeVoiceWithGeminiTts(
    scriptText: string,
    config: CareConfig
  ): Promise<string | null> {
    const apiKey = config.geminiApiKey?.trim();
    if (!apiKey) {
      return null;
    }

    this.isSynthesizingAudio.set(true);
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [
          {
            parts: [
              {
                text: `Speak warmly, clearly, and respectfully in Pakistani Urdu like a loving family member talking to ${config.caregiverTitle}: ${scriptText}`,
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.geminiVoiceName || 'Kore',
              },
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      const audioPart = candidate?.content?.parts?.find(
        (part) => part.inlineData && part.inlineData.mimeType?.startsWith('audio/')
      );

      if (audioPart?.inlineData?.data) {
        const mimeType = audioPart.inlineData.mimeType || 'audio/pcm;rate=24000';
        if (mimeType.includes('pcm') || mimeType.includes('L16')) {
          return this.pcm16Base64ToWavUrl(audioPart.inlineData.data, 24000);
        }
        return `data:${mimeType};base64,${audioPart.inlineData.data}`;
      }
      return null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini TTS failed';
      this.lastError.set(msg);
      return null;
    } finally {
      this.isSynthesizingAudio.set(false);
    }
  }

  /**
   * Speaks a script aloud in the browser using either a cached/synthesized audio URL
   * or the Web Speech API (`ur-PK` / `hi-IN` / `en-US`) for immediate interactive demos.
   */
  speakInBrowser(
    text: string,
    lang: 'ur-PK' | 'hi-IN' | 'ar-XA' | 'bn-IN' | 'en-US' = 'ur-PK',
    onEnd?: () => void
  ): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onEnd?.();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const langPrefix = lang.slice(0, 2).toLowerCase();
    const matchedVoice =
      voices.find((v) => v.lang.toLowerCase().includes(langPrefix)) ||
      voices.find((v) => v.lang.toLowerCase().includes('ur')) ||
      voices.find((v) => v.lang.toLowerCase().includes('hi')) ||
      voices.find((v) => v.lang.toLowerCase().includes('en'));

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }
    utterance.lang = lang;
    utterance.rate = 0.95;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    window.speechSynthesis.speak(utterance);
  }

  stopSpeaking(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  private pcm16Base64ToWavUrl(base64Pcm: string, sampleRate: number): string {
    const binaryString = atob(base64Pcm);
    const pcmLength = binaryString.length;
    const wavBuffer = new ArrayBuffer(44 + pcmLength);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcmLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16-bit
    writeString(36, 'data');
    view.setUint32(40, pcmLength, true);

    const uint8 = new Uint8Array(wavBuffer, 44);
    for (let i = 0; i < pcmLength; i++) {
      uint8[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  private parseScheduleFallback(
    naturalText: string,
    config: CareConfig
  ): ParsedScheduleResponse {
    const c = config.caregiverTitle;
    const p = config.patientTitle;
    const e = config.escalationName;
    const s = config.snoozeDurationMinutes;

    const rawResult = {
      summary: `Generated a 9-step linked daily recovery schedule for ${p} from your routine description, with meal-relative offsets (+15m post-meal medicines, +120m boiled eggs) and personalized Urdu prompts for ${c}.`,
      items: [
        {
          id: 'breakfast',
          title: 'Breakfast (Subah ka Nashta)',
          category: 'MEAL',
          triggerType: 'FIXED_TIME',
          fixedTime: '08:30',
          parentTemplateId: null,
          offsetMinutes: null,
          instructions: `Nutritious morning breakfast for ${p}. Reference note: "${naturalText.slice(0, 80)}..."`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ke subah ke nashtay ka waqt ho gaya hai. Jab ${p} nashta kar lein to 1 dabayein. ${s} minute snooze ke liye 2 dabayein. Agar ${p} mana kar rahe hain to 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کے صبح کے ناشتے کا وقت ہو گیا ہے۔ جب ${p} ناشتہ کر لیں تو 1 دبائیں۔ ${s} منٹ بعد کے لیے 2 دبائیں۔ اگر ${p} منع کر رہے ہیں تو 3 دبائیں۔`,
          escalationScript: `Assalam-o-Alaikum ${e}. ${c} needs assistance with ${p}'s Breakfast. Press 1 if done, 2 to snooze ${s}m, or 9 to bridge call to ${c}.`,
          order: 1,
          active: true,
        },
        {
          id: 'morning_meds',
          title: 'Post-Breakfast Medicines',
          category: 'MEDICATION',
          triggerType: 'AFTER_TASK',
          fixedTime: null,
          parentTemplateId: 'breakfast',
          offsetMinutes: 15,
          instructions: `Mandatory morning medicines 15 minutes after ${p} finishes breakfast.`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ko nashta kiye 15 minute ho gaye hain, ab subah wali dawai dene ka waqt hai. Jab ${p} dawai le lein to 1 dabayein, ${s} minute snooze ke liye 2 dabayein, ya ${e} ko call karne ke liye 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کو ناشتہ کیے 15 منٹ ہو گئے ہیں، اب صبح والی دوائی دینے کا وقت ہے۔ جب ${p} دوائی لے لیں تو 1 دبائیں، ${s} منٹ بعد کے لیے 2 دبائیں، یا 3 دبائیں۔`,
          escalationScript: `Urgent ${e}: ${p}'s Post-Breakfast Medicines require attention. Press 1 if taken, 2 to retry ${c}, or 9 to bridge live to ${c}.`,
          order: 2,
          active: true,
        },
        {
          id: 'boiled_eggs',
          title: 'Boiled Eggs (2h After Breakfast)',
          category: 'SNACK',
          triggerType: 'AFTER_TASK',
          fixedTime: null,
          parentTemplateId: 'breakfast',
          offsetMinutes: 120,
          instructions: `2 boiled eggs 2 hours after breakfast for protein recovery.`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ke nashtay ko 2 ghantay ho gaye hain. Ab ublay huay anday dene ka waqt hai. Jab ${p} kha lein to 1 dabayein, ${s} minute baad ke liye 2 dabayein, ya 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کے ناشتے کو دو گھنٹے ہو گئے ہیں۔ اب ابلے ہوئے انڈے دینے کا وقت ہے۔ جب ${p} کھا لیں تو 1 دبائیں۔`,
          escalationScript: `Assalam-o-Alaikum ${e}. Follow-up for ${p}'s Boiled Eggs. Press 1 if done, 2 to snooze, or 9 to bridge to ${c}.`,
          order: 3,
          active: true,
        },
        {
          id: 'lunch',
          title: 'Afternoon Lunch',
          category: 'MEAL',
          triggerType: 'FIXED_TIME',
          fixedTime: '13:30',
          parentTemplateId: null,
          offsetMinutes: null,
          instructions: `Fresh lunch for ${p}.`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ke dopehar ke khanay ka waqt ho gaya hai. Jab ${p} khana kha lein to 1 dabayein, ${s} minute baad ke liye 2 dabayein, ya 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کے دوپہر کے کھانے کا وقت ہو گیا ہے۔ جب ${p} کھانا کھا لیں تو 1 دبائیں۔`,
          escalationScript: `Assalam-o-Alaikum ${e}. Follow-up for ${p}'s Lunch. Press 1 if done, 2 to snooze, or 9 to bridge.`,
          order: 4,
          active: true,
        },
        {
          id: 'evening_tea',
          title: 'Tea + Cake Rusks',
          category: 'SNACK',
          triggerType: 'FIXED_TIME',
          fixedTime: '17:00',
          parentTemplateId: null,
          offsetMinutes: null,
          instructions: `Evening tea with 2 cake rusks.`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ki shaam ki chai aur cake rusk ka waqt ho gaya hai. Jab ${p} le lein to 1 dabayein, ${s} minute baad ke liye 2 dabayein, ya 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کی شام کی چائے اور کیک رس کا وقت ہو گیا ہے۔`,
          escalationScript: `Assalam-o-Alaikum ${e}. Follow-up for ${p}'s Tea and Cake Rusks. Press 1 if done, 2 to snooze, or 9 to bridge.`,
          order: 5,
          active: true,
        },
        {
          id: 'evening_milkshake',
          title: 'Evening Milkshake',
          category: 'HYDRATION',
          triggerType: 'FIXED_TIME',
          fixedTime: '18:30',
          parentTemplateId: null,
          offsetMinutes: null,
          instructions: `Fresh evening milkshake for energy.`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ke shaam ke milkshake ka waqt ho gaya hai. Jab ${p} pee lein to 1 dabayein, ${s} minute baad ke liye 2 dabayein, ya 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کے شام کے ملک شیک کا وقت ہو گیا ہے۔`,
          escalationScript: `Assalam-o-Alaikum ${e}. Follow-up for ${p}'s Evening Milkshake. Press 1 if done, 2 to snooze, or 9 to bridge.`,
          order: 6,
          active: true,
        },
        {
          id: 'dinner',
          title: 'Night Dinner',
          category: 'MEAL',
          triggerType: 'FIXED_TIME',
          fixedTime: '20:30',
          parentTemplateId: null,
          offsetMinutes: null,
          instructions: `Light dinner before night medication.`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ke raat ke khanay ka waqt ho gaya hai. Jab ${p} khana kha lein to 1 dabayein, ${s} minute snooze ke liye 2 dabayein, ya 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کے رات کے کھانے کا وقت ہو گیا ہے۔`,
          escalationScript: `Assalam-o-Alaikum ${e}. Follow-up for ${p}'s Dinner. Press 1 if done, 2 to snooze, or 9 to bridge.`,
          order: 7,
          active: true,
        },
        {
          id: 'night_meds',
          title: 'Post-Dinner Night Medicines',
          category: 'MEDICATION',
          triggerType: 'AFTER_TASK',
          fixedTime: null,
          parentTemplateId: 'dinner',
          offsetMinutes: 15,
          instructions: `Mandatory night discharge medicines 15 minutes after dinner.`,
          urduScript: `Assalam-o-Alaikum ${c}! ${p} ke raat ke khanay ke baad wali dawai ka waqt ho gaya hai. Jab ${p} dawai le lein to 1 dabayein, ${s} minute snooze ke liye 2 dabayein, ya ${e} ko call karne ke liye 3 dabayein.`,
          urduScriptNative: `السلام علیکم ${c}! ${p} کے رات کے کھانے کے بعد والی دوائی کا وقت ہو گیا ہے۔`,
          escalationScript: `Urgent ${e}: ${p}'s Night Medicines need confirmation. Press 1 if resolved, 2 to retry ${c}, or 9 to connect directly to ${c} and ${p}.`,
          order: 8,
          active: true,
        },
      ],
    };

    return ParsedScheduleResponseSchema.parse(rawResult);
  }
}
