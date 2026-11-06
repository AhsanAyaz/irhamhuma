import * as admin from 'firebase-admin';
import twilio from 'twilio';
import { CareConfig, CareConfigSchema } from './schemas';
import { synthesizeNativeUrduMp3Buffer } from './ai-service';

const VoiceResponse = twilio.twiml.VoiceResponse;

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in environment.');
  }
  return twilio(sid, token);
}

export function getBaseRouterUrl(): string {
  if (process.env.PUBLIC_WEBHOOK_BASE_URL) {
    return process.env.PUBLIC_WEBHOOK_BASE_URL.replace(/\/$/, '');
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'your-firebase-project';
  return `https://us-central1-${projectId}.cloudfunctions.net/twimlRouter`;
}

export function assertAllowedPhoneNumber(rawPhone: string): string {
  const normalized = rawPhone.replace(/\s+/g, '').trim();
  const rawPrefixes = process.env.ALLOWED_CALL_PREFIXES || '+92,+46';
  const prefixes = rawPrefixes
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('+'));

  const isAllowed =
    /^\+\d{8,15}$/.test(normalized) &&
    prefixes.some((prefix) => normalized.startsWith(prefix));

  if (!isAllowed) {
    throw new Error(
      `Blocked outbound call to ${normalized}: phone prefix is not in ALLOWED_CALL_PREFIXES (${prefixes.join(', ')}).`
    );
  }
  return normalized;
}

export async function getCareConfig(): Promise<CareConfig> {
  const doc = await admin.firestore().doc('settings/careConfig').get();
  if (!doc.exists) {
    return CareConfigSchema.parse({
      caregiverPhone: process.env.DEFAULT_CAREGIVER_PHONE || '',
      escalationPhone: process.env.DEFAULT_ESCALATION_PHONE || '',
    });
  }
  return CareConfigSchema.parse(doc.data());
}

/**
 * Generates an on-the-fly 100% Native Urdu MP3 Buffer using Google Cloud Text-to-Speech
 * (`ur-IN-Wavenet-A` / `ur-PK-Standard-A`) fed with actual Nastaliq Urdu script,
 * for BOTH Caregiver and Escalation calls.
 * Zero Twilio <Say> is used anywhere!
 */
export async function buildUrduAudioMp3ForTwilio(
  taskId: string,
  audioType: string,
  customText?: string,
  voiceOverride?: string
): Promise<Buffer> {
  const config = await getCareConfig();
  let urduText = customText || '';

  if (!urduText) {
    const taskSnap = taskId
      ? await admin.firestore().doc(`dailyTasks/${taskId}`).get()
      : null;
    const task = taskSnap?.exists ? taskSnap.data() || {} : {};
    const taskTitle = (task.title as string) || 'دوائی';

    switch (audioType) {
      case 'confirm_done':
        urduText = `جزاک اللہ ${config.caregiverTitle}! ریکارڈ محفوظ ہو گیا ہے۔ اللہ ${config.patientTitle} کو صحت کاملہ عطا فرمائے۔`;
        break;
      case 'confirm_snooze':
        urduText = `ٹھیک ہے ${config.caregiverTitle}، ${config.snoozeDurationMinutes} منٹ بعد دوبارہ یاد دلائیں گے۔`;
        break;
      case 'confirm_escalate':
        urduText = `پریشان نہ ہوں ${config.caregiverTitle}، ابھی ${config.escalationName} کو کال جا رہی ہے۔`;
        break;
      case 'no_input':
        urduText = `کوئی بٹن نہیں دبایا گیا۔ براہ کرم ایک، دو، یا تین دبائیں۔`;
        break;
      case 'escalation_prompt': {
        const reason = (task.escalationReason as string) || 'PATIENT_REFUSING';
        if (reason === 'PATIENT_REFUSING') {
          urduText = `السلام علیکم ${config.escalationName}! ایمرجنسی اطلاع: ${config.caregiverTitle} نے بتایا ہے کہ ${config.patientTitle} ${taskTitle} لینے سے منع کر رہے ہیں۔ اگر آپ نے مسئلہ حل کر لیا ہے تو ایک دبائیں۔ ${config.snoozeDurationMinutes} منٹ بعد ${config.caregiverTitle} کو دوبارہ کال کرنے کے لیے دو دبائیں۔ یا ابھی اسی کال پر ${config.caregiverTitle} اور ${config.patientTitle} سے براہ راست بات کرنے کے لیے نو دبائیں۔`;
        } else {
          urduText = `السلام علیکم ${config.escalationName}! ${config.patientTitle} کے ${taskTitle} کے لیے ${config.caregiverTitle} نے فون نہیں اٹھایا۔ اگر یہ کام ہو چکا ہے تو ایک دبائیں۔ ${config.snoozeDurationMinutes} منٹ بعد دوبارہ کال کے لیے دو دبائیں۔ یا ابھی ${config.caregiverTitle} سے بات کرنے کے لیے نو دبائیں۔`;
        }
        break;
      }
      case 'escalation_done':
        urduText = `جزاک اللہ ${config.escalationName}! ریکارڈ مکمل کر دیا گیا ہے۔`;
        break;
      case 'escalation_snooze':
        urduText = `ٹھیک ہے ${config.escalationName}، ${config.snoozeDurationMinutes} منٹ بعد ${config.caregiverTitle} کو دوبارہ کال کی جائے گی۔`;
        break;
      case 'escalation_bridge':
        urduText = `آپ کی کال ابھی ${config.caregiverTitle} اور ${config.patientTitle} کے نمبر سے ملائی جا رہی ہے۔`;
        break;
      case 'whatsapp':
        urduText =
          (task.urduScriptNative as string) ||
          `السلام علیکم ${config.caregiverTitle}! ابھی ${config.patientTitle} کے ${taskTitle} کا وقت ہو گیا ہے۔ جب ${config.patientTitle} یہ لے لیں تو جواب میں ایک لکھ کر بھیجیں۔ پندرہ منٹ بعد یاد دلانے کے لیے دو لکھ کر بھیجیں۔ اگر ${config.patientTitle} منع کر رہے ہیں تو تین لکھ کر بھیجیں۔`;
        urduText = urduText
          .replace(/تو 1 دبائیں/g, 'تو جواب میں 1 لکھ کر بھیجیں')
          .replace(/1 دبائیں/g, '1 لکھ کر بھیجیں')
          .replace(/2 دبائیں/g, '2 لکھ کر بھیجیں')
          .replace(/3 دبائیں/g, '3 لکھ کر بھیجیں')
          .replace(/3 دبا کر/g, '3 لکھ کر');
        break;
      default:
        urduText =
          (task.urduScriptNative as string) ||
          `السلام علیکم ${config.caregiverTitle}! ابھی ${config.patientTitle} کے ${taskTitle} کا وقت ہو گیا ہے۔ جب ${config.patientTitle} یہ لے لیں تو ایک دبائیں۔ پندرہ منٹ بعد یاد دلانے کے لیے دو دبائیں۔ اگر ${config.patientTitle} منع کر رہے ہیں تو تین دبائیں۔`;
        if (audioType === 'caregiver') {
          urduText = urduText.replace(/لکھ کر بھیجیں/g, 'دبائیں');
        }
        break;
    }
  } else {
    urduText = urduText
      .replace(/تو 1 دبائیں/g, 'تو جواب میں 1 لکھ کر بھیجیں')
      .replace(/1 دبائیں/g, '1 لکھ کر بھیجیں')
      .replace(/2 دبائیں/g, '2 لکھ کر بھیجیں')
      .replace(/3 دبائیں/g, '3 لکھ کر بھیجیں')
      .replace(/3 دبا کر/g, '3 لکھ کر');
  }

  if (!config.enableTwilioCalls) {
    urduText = urduText
      .replace(/کال جائے/g, 'فوری اطلاع مل جائے')
      .replace(/کال کی جا سکے/g, 'فوری اطلاع دی جا سکے')
      .replace(/کال کریں/g, 'فوری اطلاع دیں');
  }

  return synthesizeNativeUrduMp3Buffer(
    urduText,
    voiceOverride || config.voiceName || 'ur-PK-Standard-A'
  );
}

/**
 * Initiates an outbound Twilio call to Caregiver or Escalation Contact.
 * For CAREGIVER (unless `forceCellular: true`), attempts a Twilio WhatsApp Voice Call (`whatsapp:+...`)
 * first, and automatically falls back to a standard PSTN cellular call (`+...`) if WhatsApp calling
 * is not enabled or not permitted.
 */
export async function placeOutboundCall(
  taskId: string,
  targetRole: 'CAREGIVER' | 'ESCALATION',
  options?: { forceCellular?: boolean; forceEvenIfDisabled?: boolean }
): Promise<string> {
  const config = await getCareConfig();
  if (!config.enableTwilioCalls && !options?.forceEvenIfDisabled) {
    return 'TWILIO_CALLS_DISABLED';
  }
  const client = getTwilioClient();
  const baseUrl = getBaseRouterUrl();
  const fromPhone = (
    process.env.TWILIO_PHONE_NUMBER ||
    config.twilioWhatsappNumber ||
    ''
  )
    .replace(/\s+/g, '')
    .replace(/^whatsapp:/i, '');
  const whatsappSender = (
    config.twilioWhatsappNumber ||
    process.env.TWILIO_WHATSAPP_NUMBER ||
    fromPhone
  )
    .replace(/\s+/g, '')
    .replace(/^whatsapp:/i, '');

  const toPhone = assertAllowedPhoneNumber(
    targetRole === 'CAREGIVER' ? config.caregiverPhone : config.escalationPhone
  );

  const twimlEndpoint =
    targetRole === 'CAREGIVER'
      ? `${baseUrl}/caregiver?taskId=${encodeURIComponent(taskId)}`
      : `${baseUrl}/escalation?taskId=${encodeURIComponent(taskId)}`;

  // Try WhatsApp Voice Call first for Caregiver (unless forceCellular is set, e.g. on Attempt #2 or fallback)
  if (targetRole === 'CAREGIVER' && !options?.forceCellular && whatsappSender) {
    try {
      const waCall = await client.calls.create({
        to: `whatsapp:${toPhone}`,
        from: `whatsapp:${whatsappSender}`,
        url: `${twimlEndpoint}&channel=whatsapp`,
        statusCallback: `${baseUrl}/status?taskId=${encodeURIComponent(taskId)}&role=${targetRole}&channel=whatsapp`,
        statusCallbackEvent: ['completed'],
      });
      return waCall.sid;
    } catch {
      // Synchronous fallback to regular PSTN cellular call if WhatsApp calling is not enabled/permitted
    }
  }

  const call = await client.calls.create({
    to: toPhone,
    from: fromPhone,
    url: `${twimlEndpoint}&channel=cellular`,
    statusCallback: `${baseUrl}/status?taskId=${encodeURIComponent(taskId)}&role=${targetRole}&channel=cellular`,
    statusCallbackEvent: ['completed'],
  });

  return call.sid;
}

/**
 * Places a real Twilio call for a task using authoritative phone numbers from Firestore settings/careConfig.
 * Never overwrites careConfig or dials arbitrary numbers from the request body.
 */
export async function syncAndTriggerLiveCall(payload: {
  task: Record<string, unknown>;
  config?: Record<string, unknown>;
  targetRole: 'CAREGIVER' | 'ESCALATION';
}): Promise<{ callSid: string; toPhone: string; attemptCount: number }> {
  const db = admin.firestore();
  const authoritativeConfig = await getCareConfig();

  const taskId = String(payload.task?.id || `live_${Date.now()}`);
  const taskRef = db.doc(`dailyTasks/${taskId}`);
  const existingSnap = await taskRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : null;
  const nextAttemptCount = ((existingData?.attemptCount as number) || 0) + 1;

  if (existingSnap.exists) {
    await taskRef.update({
      status:
        payload.targetRole === 'CAREGIVER' ? 'CALLING_CAREGIVER' : 'ESCALATED',
      attemptCount: nextAttemptCount,
      updatedAt: new Date().toISOString(),
    });
  }

  const toPhone = assertAllowedPhoneNumber(
    payload.targetRole === 'CAREGIVER'
      ? authoritativeConfig.caregiverPhone
      : authoritativeConfig.escalationPhone
  );

  const callSid = await placeOutboundCall(taskId, payload.targetRole);

  return { callSid, toPhone, attemptCount: nextAttemptCount };
}

/**
 * Generates TwiML when Primary Caregiver answers the phone.
 * Uses pure `input: ['dtmf']` with `numDigits: 1` so pressing 1, 2, or 3 interrupts <Play>
 * and registers INSTANTLY on the very first press without waiting for a speech recognizer timeout!
 */
export async function buildCaregiverPromptTwiml(taskId: string): Promise<string> {
  const baseUrl = getBaseRouterUrl();
  const audioPlayUrl = `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=caregiver`;

  const response = new VoiceResponse();
  const gather = response.gather({
    input: ['dtmf'],
    numDigits: 1,
    timeout: 10,
    finishOnKey: '',
    action: `${baseUrl}/caregiver-gather?taskId=${encodeURIComponent(taskId)}`,
    method: 'POST',
  });

  gather.play(audioPlayUrl);

  // If caregiver doesn't press a key within 10s, repeat the Native Urdu prompt once more
  const secondGather = response.gather({
    input: ['dtmf'],
    numDigits: 1,
    timeout: 10,
    finishOnKey: '',
    action: `${baseUrl}/caregiver-gather?taskId=${encodeURIComponent(taskId)}`,
    method: 'POST',
  });
  secondGather.play(audioPlayUrl);

  return response.toString();
}

/**
 * Handles Caregiver keypad response (1, 2, or 3) using 100% Native Urdu <Play> audio.
 */
export async function handleCaregiverGatherTwiml(
  taskId: string,
  digits?: string,
  speechResult?: string
): Promise<string> {
  const config = await getCareConfig();
  const baseUrl = getBaseRouterUrl();
  const db = admin.firestore();
  const taskRef = db.doc(`dailyTasks/${taskId}`);
  const taskSnap = await taskRef.get();
  const task = taskSnap.data() || {};
  const response = new VoiceResponse();

  const choice = (digits || speechResult || '').trim();

  if (choice === '1') {
    const nowIso = new Date().toISOString();
    const completedByLabel = `${config.caregiverTitle} (Phone Call)`;
    await taskRef.update({
      status: 'COMPLETED',
      completedAt: nowIso,
      completedBy: completedByLabel,
    });

    // Unlock dependent AFTER_TASK items (e.g. +15m Morning Meds, +120m Boiled Eggs)
    const unlockedTitles: string[] = [];
    if (task.dateKey && task.templateId) {
      const dependentsSnap = await db
        .collection('dailyTasks')
        .where('dateKey', '==', task.dateKey)
        .where('parentTemplateId', '==', task.templateId)
        .where('status', '==', 'WAITING_FOR_PARENT')
        .get();

      const batch = db.batch();
      for (const childDoc of dependentsSnap.docs) {
        const child = childDoc.data();
        const offsetMins = (child.offsetMinutes as number) ?? 15;
        const offsetMs = offsetMins * 60_000;
        batch.update(childDoc.ref, {
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + offsetMs).toISOString(),
        });
        unlockedTitles.push(`${child.title} (+${offsetMins}m)`);
      }
      await batch.commit();
    }

    if (config.notifyEscalationOnCompletion) {
      const title = String(task.title || 'Care Task');
      const nextLine =
        unlockedTitles.length > 0
          ? `\n🔗 Next scheduled: ${unlockedTitles.join(', ')}`
          : '';
      const msgBody =
        `✅ *Irhamhuma — ${title} Done*\n` +
        `*${config.caregiverTitle}* confirmed *${title}* for *${config.patientTitle}* (${completedByLabel}).${nextLine}`;

      const escChannel = config.escalationChannel || 'TELEGRAM';
      const botToken = (
        config.telegramBotToken ||
        process.env.TELEGRAM_BOT_TOKEN ||
        ''
      ).trim();
      const sonChatId = (
        config.escalationTelegramChatId ||
        process.env.ESCALATION_TELEGRAM_CHAT_ID ||
        ''
      ).trim();

      let telegramSent = false;
      if ((escChannel === 'TELEGRAM' || escChannel === 'BOTH') && botToken && sonChatId) {
        try {
          const res = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: sonChatId,
                text: msgBody,
                parse_mode: 'Markdown',
              }),
            }
          );
          telegramSent = res.ok;
        } catch {
          // Non-blocking
        }
      }

      if (
        (escChannel === 'WHATSAPP' || escChannel === 'BOTH' || !telegramSent) &&
        config.escalationPhone
      ) {
        try {
          const client = getTwilioClient();
          const waFrom = (
            config.twilioWhatsappNumber ||
            process.env.TWILIO_WHATSAPP_NUMBER ||
            process.env.TWILIO_PHONE_NUMBER ||
            ''
          )
            .replace(/\s+/g, '')
            .replace(/^whatsapp:/i, '');
          const waTo = config.escalationPhone.replace(/\s+/g, '').replace(/^whatsapp:/i, '');
          await client.messages.create({
            from: `whatsapp:${waFrom}`,
            to: `whatsapp:${waTo}`,
            body: msgBody,
          });
        } catch {
          // Non-blocking notification
        }
      }
    }

    response.play(
      `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=confirm_done`
    );
    return response.toString();
  }

  if (choice === '2') {
    const nextSnooze = ((task.snoozeCount as number) || 0) + 1;
    if (nextSnooze > config.maxSnoozes) {
      await taskRef.update({
        status: 'ESCALATED',
        escalationReason: 'TOO_MANY_SNOOZES',
      });
      await placeOutboundCall(taskId, 'ESCALATION');
      response.play(
        `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=confirm_escalate`
      );
      return response.toString();
    }

    const snoozeMs = config.snoozeDurationMinutes * 60_000;
    await taskRef.update({
      status: 'SNOOZED',
      snoozeCount: nextSnooze,
      scheduledAt: new Date(Date.now() + snoozeMs).toISOString(),
    });

    response.play(
      `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=confirm_snooze`
    );
    return response.toString();
  }

  if (choice === '3') {
    await taskRef.update({
      status: 'ESCALATED',
      escalationReason: 'PATIENT_REFUSING',
    });
    await placeOutboundCall(taskId, 'ESCALATION');
    response.play(
      `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=confirm_escalate`
    );
    return response.toString();
  }

  response.play(
    `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=no_input`
  );
  return response.toString();
}

/**
 * Generates TwiML when Escalation Contact answers the phone.
 * Uses 100% Native Urdu <Play> via Google Cloud TTS WaveNet (type=escalation_prompt)
 * and pure DTMF (`input: ['dtmf']`) for instant keypad response!
 */
export async function buildEscalationPromptTwiml(taskId: string): Promise<string> {
  const baseUrl = getBaseRouterUrl();
  const escalationAudioUrl = `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=escalation_prompt`;

  const response = new VoiceResponse();
  const gather = response.gather({
    input: ['dtmf'],
    numDigits: 1,
    timeout: 12,
    finishOnKey: '',
    action: `${baseUrl}/escalation-gather?taskId=${encodeURIComponent(taskId)}`,
    method: 'POST',
  });

  gather.play(escalationAudioUrl);

  // Repeat once if no key pressed within 12s
  const secondGather = response.gather({
    input: ['dtmf'],
    numDigits: 1,
    timeout: 10,
    finishOnKey: '',
    action: `${baseUrl}/escalation-gather?taskId=${encodeURIComponent(taskId)}`,
    method: 'POST',
  });
  secondGather.play(escalationAudioUrl);

  return response.toString();
}

/**
 * Handles Escalation Contact keypad response using 100% Native Urdu <Play>:
 * - 1: Mark completed
 * - 2: Re-call Caregiver in 15m
 * - 9: Live Bridge (<Dial> connects Escalation Contact directly to Caregiver/Patient)
 */
export async function handleEscalationGatherTwiml(
  taskId: string,
  digits?: string
): Promise<string> {
  const config = await getCareConfig();
  const baseUrl = getBaseRouterUrl();
  const db = admin.firestore();
  const taskRef = db.doc(`dailyTasks/${taskId}`);
  const taskSnap = await taskRef.get();
  const task = taskSnap.data() || {};
  const response = new VoiceResponse();
  const choice = (digits || '').trim();

  if (choice === '1') {
    await taskRef.update({
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      completedBy: config.escalationName,
    });

    if (task.dateKey && task.templateId) {
      const dependentsSnap = await db
        .collection('dailyTasks')
        .where('dateKey', '==', task.dateKey)
        .where('parentTemplateId', '==', task.templateId)
        .where('status', '==', 'WAITING_FOR_PARENT')
        .get();

      const batch = db.batch();
      for (const childDoc of dependentsSnap.docs) {
        const child = childDoc.data();
        const offsetMs = (child.offsetMinutes ?? 15) * 60_000;
        batch.update(childDoc.ref, {
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + offsetMs).toISOString(),
        });
      }
      await batch.commit();
    }

    response.play(
      `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=escalation_done`
    );
    return response.toString();
  }

  if (choice === '2') {
    const snoozeMs = config.snoozeDurationMinutes * 60_000;
    await taskRef.update({
      status: 'SNOOZED',
      snoozeCount: 0,
      attemptCount: 0,
      scheduledAt: new Date(Date.now() + snoozeMs).toISOString(),
    });
    response.play(
      `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=escalation_snooze`
    );
    return response.toString();
  }

  if (choice === '9') {
    await taskRef.update({
      status: 'BRIDGED',
    });
    response.play(
      `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=escalation_bridge`
    );
    response.dial(
      {
        callerId: process.env.TWILIO_PHONE_NUMBER || config.twilioWhatsappNumber || '',
        timeout: 30,
      },
      assertAllowedPhoneNumber(config.caregiverPhone)
    );
    return response.toString();
  }

  response.play(
    `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=no_input`
  );
  return response.toString();
}
