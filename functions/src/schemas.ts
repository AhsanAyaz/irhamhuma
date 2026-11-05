import { z } from 'zod';

export const TaskCategorySchema = z.enum(['MEAL', 'MEDICATION', 'SNACK', 'HYDRATION']);
export const TriggerTypeSchema = z.enum(['FIXED_TIME', 'AFTER_TASK']);

export const UrduVoiceNameSchema = z
  .enum([
    'ur-PK-Standard-A',
    'ur-IN-Wavenet-A',
    'ur-IN-Wavenet-B',
    'hi-IN-Wavenet-A',
    'hi-IN-Wavenet-B',
    'ar-XA-Wavenet-A',
    'bn-IN-Wavenet-A',
    'en-US-Wavenet-F',
  ])
  .catch('ur-PK-Standard-A');

export const NotificationChannelSchema = z
  .enum(['WHATSAPP', 'TELEGRAM', 'BOTH'])
  .catch('WHATSAPP');

export const EscalationChannelSchema = z
  .enum(['TELEGRAM', 'WHATSAPP', 'BOTH'])
  .catch('TELEGRAM');

export const CareConfigSchema = z.object({
  appName: z.string().default('Irhamhuma'),
  patientTitle: z.string().default('Patient'),
  caregiverTitle: z.string().default('Caregiver'),
  escalationName: z.string().default('Family Member'),
  caregiverPhone: z.string().default(''),
  patientPhone: z.string().optional(),
  escalationPhone: z.string().default(''),
  timezone: z.string().default('Asia/Karachi'),
  snoozeDurationMinutes: z.number().int().default(15),
  maxSnoozes: z.number().int().default(3),
  retryDelayMinutes: z.number().int().default(3),
  language: z.enum(['ur-PK', 'hi-IN', 'ar-XA', 'bn-IN', 'en-US']).catch('ur-PK').default('ur-PK'),
  ttsEngine: z.enum(['GEMINI_TTS', 'GOOGLE_CLOUD_TTS', 'BROWSER_SYNTHESIS']).default('GOOGLE_CLOUD_TTS'),
  voiceName: UrduVoiceNameSchema.default('ur-PK-Standard-A'),
  geminiVoiceName: z.string().default('Kore'),
  enableCostSaverCascade: z.boolean().default(true),
  enableTwilioCalls: z.boolean().default(false),
  enableWhatsAppAudioNote: z.boolean().default(false),
  notifyEscalationOnCompletion: z.boolean().default(true),
  caregiverChannel: NotificationChannelSchema.default('WHATSAPP'),
  escalationChannel: EscalationChannelSchema.default('TELEGRAM'),
  tier2NudgeAfterMinutes: z.number().int().default(3),
  tier3TwilioFallbackAfterMinutes: z.number().int().default(5),
  twilioWhatsappNumber: z.string().default(''),
  telegramBotToken: z.string().optional(),
  caregiverTelegramChatId: z.string().optional(),
  escalationTelegramChatId: z.string().optional(),
  caregiverTelegramUsername: z.string().optional(),
  enableCallMeBotVoiceCall: z.boolean().default(false),
});

export type CareConfig = z.infer<typeof CareConfigSchema>;

export const ScheduleTemplateItemSchema = z.object({
  id: z.string().describe('Unique snake_case identifier for the task, e.g., breakfast or morning_meds'),
  title: z.string().describe('Short clear display title of the task'),
  category: TaskCategorySchema,
  triggerType: TriggerTypeSchema,
  fixedTime: z.string().nullable().describe('24h time HH:mm if FIXED_TIME, else null'),
  parentTemplateId: z.string().nullable().describe('ID of parent task if AFTER_TASK, else null'),
  offsetMinutes: z.number().int().nullable().describe('Minutes after parent task completion if AFTER_TASK'),
  instructions: z.string(),
  urduScript: z.string(),
  urduScriptNative: z.string(),
  escalationScript: z.string(),
  order: z.number().int(),
  active: z.boolean().default(true),
});

export type ScheduleTemplateItem = z.infer<typeof ScheduleTemplateItemSchema>;

export const ParsedScheduleResponseSchema = z.object({
  summary: z.string(),
  items: z.array(ScheduleTemplateItemSchema),
});

export type ParsedScheduleResponse = z.infer<typeof ParsedScheduleResponseSchema>;
