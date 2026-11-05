import { z } from 'zod';

export const TaskCategorySchema = z.enum(['MEAL', 'MEDICATION', 'SNACK', 'HYDRATION']);
export type TaskCategory = z.infer<typeof TaskCategorySchema>;

export const TriggerTypeSchema = z.enum(['FIXED_TIME', 'AFTER_TASK']);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const TaskStatusSchema = z.enum([
  'WAITING_FOR_PARENT',
  'SCHEDULED',
  'TIER1_NOTIFYING',
  'TIER2_NUDGING_SON',
  'CALLING_CAREGIVER',
  'RETRY_WAIT',
  'SNOOZED',
  'ESCALATED',
  'BRIDGED',
  'COMPLETED',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const EscalationReasonSchema = z.enum([
  'NONE',
  'NO_ANSWER',
  'PATIENT_REFUSING',
  'TOO_MANY_SNOOZES',
  'MANUAL',
]);
export type EscalationReason = z.infer<typeof EscalationReasonSchema>;

export const TtsEngineSchema = z.enum(['GEMINI_TTS', 'GOOGLE_CLOUD_TTS', 'BROWSER_SYNTHESIS']);
export type TtsEngine = z.infer<typeof TtsEngineSchema>;

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
export type UrduVoiceName = z.infer<typeof UrduVoiceNameSchema>;

export const NotificationChannelSchema = z
  .enum(['WHATSAPP', 'TELEGRAM', 'BOTH'])
  .catch('WHATSAPP');
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const EscalationChannelSchema = z
  .enum(['TELEGRAM', 'WHATSAPP', 'BOTH'])
  .catch('TELEGRAM');
export type EscalationChannel = z.infer<typeof EscalationChannelSchema>;

export const WhatsAppProviderSchema = z
  .enum(['META_CLOUD_API', 'TWILIO'])
  .catch('TWILIO');
export type WhatsAppProvider = z.infer<typeof WhatsAppProviderSchema>;

export const CareConfigSchema = z.object({
  appName: z.string().default('Irhamhuma'),
  patientTitle: z.string().min(1).default('Patient'),
  caregiverTitle: z.string().min(1).default('Caregiver'),
  escalationName: z.string().min(1).default('Family Member'),
  caregiverPhone: z.string().default(''),
  patientPhone: z.string().default(''),
  escalationPhone: z.string().default(''),
  timezone: z.string().default('Asia/Karachi'),
  snoozeDurationMinutes: z.number().int().min(1).max(120).default(15),
  maxSnoozes: z.number().int().min(1).max(10).default(3),
  retryDelayMinutes: z.number().int().min(1).max(30).default(3),
  language: z.enum(['ur-PK', 'hi-IN', 'ar-XA', 'bn-IN', 'en-US']).catch('ur-PK').default('ur-PK'),
  ttsEngine: TtsEngineSchema.default('GOOGLE_CLOUD_TTS'),
  voiceName: UrduVoiceNameSchema.default('ur-PK-Standard-A'),
  geminiVoiceName: z.string().default('Kore'),
  geminiApiKey: z.string().optional(),
  backendWebhookUrl: z.string().optional(),
  enableCostSaverCascade: z.boolean().default(true),
  enableTwilioCalls: z.boolean().default(false),
  enableWhatsAppAudioNote: z.boolean().default(false),
  notifyEscalationOnCompletion: z.boolean().default(true),
  caregiverChannel: NotificationChannelSchema.default('WHATSAPP'),
  escalationChannel: EscalationChannelSchema.default('TELEGRAM'),
  tier2NudgeAfterMinutes: z.number().int().min(1).max(30).default(3),
  tier3TwilioFallbackAfterMinutes: z.number().int().min(1).max(60).default(5),
  whatsappProvider: WhatsAppProviderSchema.default('TWILIO'),
  twilioWhatsappNumber: z.string().default(''),
  metaPhoneNumberId: z.string().optional(),
  metaAccessToken: z.string().optional(),
  metaVerifyToken: z.string().default('irhamhuma_meta_verify'),
  telegramBotToken: z.string().optional(),
  caregiverTelegramChatId: z.string().optional(),
  escalationTelegramChatId: z.string().optional(),
  caregiverTelegramUsername: z.string().optional(),
  enableCallMeBotVoiceCall: z.boolean().default(false),
});

export type CareConfig = z.infer<typeof CareConfigSchema>;

/**
 * Zod Schema for Gemini 2.5 Flash Structured Output when parsing a natural language
 * schedule or hospital discharge prescription.
 */
export const ScheduleTemplateItemSchema = z.object({
  id: z
    .string()
    .describe('Unique snake_case identifier for the task, e.g., breakfast, morning_meds, boiled_eggs'),
  title: z.string().describe('Short clear display title of the task, e.g., Morning Medicines'),
  category: TaskCategorySchema.describe('Category of the care task: MEAL, MEDICATION, SNACK, or HYDRATION'),
  triggerType: TriggerTypeSchema.describe(
    'FIXED_TIME if scheduled at a specific clock time, or AFTER_TASK if relative to a parent meal/task completion'
  ),
  fixedTime: z
    .string()
    .nullable()
    .describe('24-hour clock time in HH:mm format if triggerType is FIXED_TIME, otherwise null'),
  parentTemplateId: z
    .string()
    .nullable()
    .describe('The id of the parent task if triggerType is AFTER_TASK, otherwise null'),
  offsetMinutes: z
    .number()
    .int()
    .nullable()
    .describe('Minutes to wait after parent task completion if triggerType is AFTER_TASK, e.g. 15 or 120'),
  instructions: z
    .string()
    .describe('Detailed instructions for the caregiver (dosage, food items, preparation notes)'),
  urduScript: z
    .string()
    .describe(
      'Warm, respectful Urdu voice script (in Roman Urdu) spoken to the primary caregiver, reminding them of the task for the patient and instructing: Reply 1 when done, Reply 2 to snooze 15m, Reply 3 if refusing.'
    ),
  urduScriptNative: z
    .string()
    .describe('The exact same warm Urdu voice prompt written in Nastaliq/Arabic Urdu script for high-accuracy Urdu TTS'),
  escalationScript: z
    .string()
    .describe(
      'Voice script spoken to the escalation contact when caregiver does not pick up or patient refuses, including: Press 1 if handled, Press 2 to re-call caregiver in 15m, Press 9 to live-bridge call to home.'
    ),
  order: z.number().int().describe('Sequential order in the daily routine starting from 1'),
  active: z.boolean().default(true),
});

export type ScheduleTemplate = z.infer<typeof ScheduleTemplateItemSchema> & {
  audioUrl?: string;
  escalationAudioUrl?: string;
};

export const ParsedScheduleResponseSchema = z.object({
  summary: z
    .string()
    .describe('Brief friendly summary of the extracted schedule and dependency chains'),
  items: z
    .array(ScheduleTemplateItemSchema)
    .describe('Ordered list of daily schedule items with fixed times and parent-child offsets'),
});

export type ParsedScheduleResponse = z.infer<typeof ParsedScheduleResponseSchema>;

export interface CallLogEntry {
  id: string;
  timestamp: string; // ISO string
  targetRole: 'CAREGIVER' | 'ESCALATION' | 'BRIDGE';
  targetName: string;
  targetPhone: string;
  attemptNumber: number;
  outcome:
    | 'CONFIRMED_DONE'
    | 'SNOOZED'
    | 'REFUSED_ESCALATED'
    | 'NO_ANSWER'
    | 'BRIDGED_CALL'
    | 'INITIATED';
  digitPressed?: '1' | '2' | '3' | '9';
  notes: string;
}

export interface DailyTask {
  id: string;
  templateId: string;
  dateKey: string; // YYYY-MM-DD
  title: string;
  category: TaskCategory;
  triggerType: TriggerType;
  fixedTime: string | null;
  parentTemplateId: string | null;
  offsetMinutes: number | null;
  instructions: string;
  urduScript: string;
  urduScriptNative: string;
  escalationScript: string;
  order: number;
  status: TaskStatus;
  scheduledAt: string | null; // ISO timestamp or HH:mm display when unlocked
  scheduledTimeDisplay: string; // e.g. "08:30" or "+15m after Breakfast"
  attemptCount: number;
  snoozeCount: number;
  escalationReason: EscalationReason;
  completedAt: string | null;
  completedBy: string | null;
  audioDataUrl?: string;
  callLogs: CallLogEntry[];
}

export const DEFAULT_CARE_CONFIG: CareConfig = {
  appName: 'Irhamhuma',
  patientTitle: 'Patient',
  caregiverTitle: 'Caregiver',
  escalationName: 'Family Member',
  caregiverPhone: '',
  patientPhone: '',
  escalationPhone: '',
  timezone: 'Asia/Karachi',
  snoozeDurationMinutes: 15,
  maxSnoozes: 3,
  retryDelayMinutes: 3,
  language: 'ur-PK',
  ttsEngine: 'GOOGLE_CLOUD_TTS',
  voiceName: 'ur-PK-Standard-A',
  geminiVoiceName: 'Kore',
  geminiApiKey: '',
  backendWebhookUrl: '',
  enableCostSaverCascade: true,
  enableTwilioCalls: false,
  enableWhatsAppAudioNote: false,
  notifyEscalationOnCompletion: true,
  caregiverChannel: 'WHATSAPP',
  escalationChannel: 'TELEGRAM',
  tier2NudgeAfterMinutes: 3,
  tier3TwilioFallbackAfterMinutes: 5,
  whatsappProvider: 'TWILIO',
  twilioWhatsappNumber: '',
  metaPhoneNumberId: '',
  metaAccessToken: '',
  metaVerifyToken: 'irhamhuma_meta_verify',
  telegramBotToken: '',
  caregiverTelegramChatId: '',
  escalationTelegramChatId: '',
  caregiverTelegramUsername: '',
  enableCallMeBotVoiceCall: false,
};

export const DEFAULT_SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: 'breakfast',
    title: 'Breakfast',
    category: 'MEAL',
    triggerType: 'FIXED_TIME',
    fixedTime: '09:00',
    parentTemplateId: null,
    offsetMinutes: null,
    instructions: 'Serve a nutritious morning breakfast and warm water.',
    urduScript:
      'Assalam-o-Alaikum! Subah ke nashtay ka waqt ho gaya hai. Mukammal hone par jawab mein 1 likh kar bhejein, 15 minute snooze ke liye 2 likh kar bhejein, ya madad ke liye 3 likh kar bhejein.',
    urduScriptNative:
      'السلام علیکم! صبح کے ناشتے کا وقت ہو گیا ہے۔ مکمل ہونے پر جواب میں 1 لکھ کر بھیجیں، 15 منٹ بعد یاد دلانے کے لیے 2 لکھ کر بھیجیں، یا مدد کے لیے 3 لکھ کر بھیجیں۔',
    escalationScript:
      'Assalam-o-Alaikum. Escalation for Breakfast. Press 1 if completed, Press 2 to re-call caregiver in 15 minutes, or Press 9 to immediately bridge this call.',
    order: 1,
    active: true,
  },
  {
    id: 'morning_routine',
    title: 'Post-Breakfast Routine',
    category: 'MEDICATION',
    triggerType: 'AFTER_TASK',
    fixedTime: null,
    parentTemplateId: 'breakfast',
    offsetMinutes: 15,
    instructions: 'Morning post-breakfast routine 15 minutes after breakfast with a glass of water.',
    urduScript:
      'Assalam-o-Alaikum! Nashtay ke 15 minute baad subah ke mamool ka waqt ho gaya hai. Mukammal hone par jawab mein 1 likh kar bhejein, 15 minute snooze ke liye 2 likh kar bhejein, ya madad ke liye 3 likh kar bhejein.',
    urduScriptNative:
      'السلام علیکم! ناشتے کے 15 منٹ بعد صبح کے معمول کا وقت ہو گیا ہے۔ مکمل ہونے پر جواب میں 1 لکھ کر بھیجیں، 15 منٹ بعد یاد دلانے کے لیے 2 لکھ کر بھیجیں، یا مدد کے لیے 3 لکھ کر بھیجیں۔',
    escalationScript:
      'Urgent alert: Post-Breakfast Routine needs confirmation. Press 1 if resolved, Press 2 to retry in 15 minutes, or Press 9 to connect directly.',
    order: 2,
    active: true,
  },
  {
    id: 'lunch',
    title: 'Lunch',
    category: 'MEAL',
    triggerType: 'FIXED_TIME',
    fixedTime: '14:00',
    parentTemplateId: null,
    offsetMinutes: null,
    instructions: 'Serve fresh home-cooked lunch with water.',
    urduScript:
      'Assalam-o-Alaikum! Dopehar ke khanay ka waqt ho gaya hai. Mukammal hone par jawab mein 1 likh kar bhejein, 15 minute snooze ke liye 2 likh kar bhejein, ya madad ke liye 3 likh kar bhejein.',
    urduScriptNative:
      'السلام علیکم! دوپہر کے کھانے کا وقت ہو گیا ہے۔ مکمل ہونے پر جواب میں 1 لکھ کر بھیجیں، 15 منٹ بعد یاد دلانے کے لیے 2 لکھ کر بھیجیں، یا مدد کے لیے 3 لکھ کر بھیجیں۔',
    escalationScript:
      'Assalam-o-Alaikum. Escalation for Lunch. Press 1 if completed, 2 to snooze 15m, or 9 to bridge call.',
    order: 3,
    active: true,
  },
  {
    id: 'evening_tea',
    title: 'Evening Tea & Snack',
    category: 'SNACK',
    triggerType: 'FIXED_TIME',
    fixedTime: '17:30',
    parentTemplateId: null,
    offsetMinutes: null,
    instructions: 'Serve evening tea and light snack.',
    urduScript:
      'Assalam-o-Alaikum! Shaam ki chai ka waqt ho gaya hai. Mukammal hone par jawab mein 1 likh kar bhejein, 15 minute snooze ke liye 2 likh kar bhejein, ya madad ke liye 3 likh kar bhejein.',
    urduScriptNative:
      'السلام علیکم! شام کی چائے کا وقت ہو گیا ہے۔ مکمل ہونے پر جواب میں 1 لکھ کر بھیجیں، 15 منٹ بعد یاد دلانے کے لیے 2 لکھ کر بھیجیں، یا مدد کے لیے 3 لکھ کر بھیجیں۔',
    escalationScript:
      'Assalam-o-Alaikum. Escalation for Evening Tea. Press 1 if completed, 2 to snooze 15m, or 9 to bridge call.',
    order: 4,
    active: true,
  },
  {
    id: 'dinner',
    title: 'Dinner',
    category: 'MEAL',
    triggerType: 'FIXED_TIME',
    fixedTime: '20:30',
    parentTemplateId: null,
    offsetMinutes: null,
    instructions: 'Serve an early, easily digestible dinner.',
    urduScript:
      'Assalam-o-Alaikum! Raat ke khanay ka waqt ho gaya hai. Mukammal hone par jawab mein 1 likh kar bhejein, 15 minute snooze ke liye 2 likh kar bhejein, ya madad ke liye 3 likh kar bhejein.',
    urduScriptNative:
      'السلام علیکم! رات کے کھانے کا وقت ہو گیا ہے۔ مکمل ہونے پر جواب میں 1 لکھ کر بھیجیں، 15 منٹ بعد یاد دلانے کے لیے 2 لکھ کر بھیجیں، یا مدد کے لیے 3 لکھ کر بھیجیں۔',
    escalationScript:
      'Assalam-o-Alaikum. Escalation for Dinner. Press 1 if completed, 2 to snooze 15m, or 9 to bridge call.',
    order: 5,
    active: true,
  },
];
