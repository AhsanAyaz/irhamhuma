import * as admin from 'firebase-admin';
import twilio from 'twilio';
import { CareConfig } from './schemas';
import {
  sendCompletionTelegramToEscalation,
  sendTier2TelegramNudgeToSon,
} from './telegram-service';
import { getBaseRouterUrl, getCareConfig, placeOutboundCall } from './voice-webhooks';

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in environment.');
  }
  return twilio(sid, token);
}

function formatWhatsAppAddress(phone: string): string {
  const cleaned = phone.replace(/\s+/g, '').replace(/^whatsapp:/i, '');
  return `whatsapp:${cleaned}`;
}

/**
 * Tier 1 (Minute 0):
 * Sends a WhatsApp message + Native Urdu MP3 Voice Note attachment to the primary caregiver via Twilio WhatsApp.
 */
export async function sendTier1WhatsAppToCaregiver(
  taskId: string,
  task: Record<string, unknown>,
  config: CareConfig
): Promise<{ sent: boolean; messageSid?: string; to: string; details: string }> {
  const client = getTwilioClient();
  const baseUrl = getBaseRouterUrl();
  const fromWhatsApp = formatWhatsAppAddress(
    config.twilioWhatsappNumber || process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || ''
  );
  const toWhatsApp = formatWhatsAppAddress(config.caregiverPhone);

  const title = String(task.title || 'دوائی');
  const instructions = String(task.instructions || '');
  const urduNative = String(
    task.urduScriptNative ||
      `السلام علیکم ${config.caregiverTitle}! ابھی ${config.patientTitle} کے ${title} کا وقت ہو گیا ہے۔`
  );

  // Append .mp3 and type=whatsapp so the voice note says "1 likh kar bhejein"
  const audioMediaUrl = `${baseUrl}/audio.mp3?taskId=${encodeURIComponent(taskId)}&type=whatsapp`;

  const bodyText =
    `🤲 *Irhamhuma — ${config.patientTitle} کے لیے یاد دہانی*\n` +
    `📋 *${title}*\n` +
    `${instructions ? `_${instructions}_\n\n` : '\n'}` +
    `🔊 ${urduNative}\n\n` +
    `براہ کرم جواب میں صرف ایک نمبر لکھ کر بھیجیں:\n` +
    `*1* — ✅ جی، ${config.patientTitle} نے لے لی (Done)\n` +
    `*2* — ⏳ ${config.snoozeDurationMinutes} منٹ بعد یاد دلائیں (Snooze)\n` +
    `*3* — 🚨 ${config.patientTitle} منع کر رہے ہیں، ${config.escalationName} کو کال کریں`;

  try {
    // 1. Send the written summary message FIRST (WhatsApp strips text captions from audio media messages!)
    const textMsg = await client.messages.create({
      from: fromWhatsApp,
      to: toWhatsApp,
      body: bodyText,
    });

    // 2. Send the Native Urdu MP3 Voice Note right after it
    let audioSid = '';
    try {
      const audioMsg = await client.messages.create({
        from: fromWhatsApp,
        to: toWhatsApp,
        mediaUrl: [audioMediaUrl],
      });
      audioSid = audioMsg.sid;
    } catch {
      // If media attachment fails, the written summary message was already delivered
    }

    await admin.firestore().doc(`dailyTasks/${taskId}`).set(
      {
        lastWhatsAppSentTo: config.caregiverPhone.replace(/\s+/g, ''),
        lastWhatsAppSid: audioSid || textMsg.sid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return {
      sent: true,
      messageSid: audioSid || textMsg.sid,
      to: toWhatsApp,
      details: `WhatsApp Summary + Urdu Voice Note sent to ${config.caregiverTitle} (${toWhatsApp})`,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'WhatsApp send failed';
    return {
      sent: false,
      to: toWhatsApp,
      details: `WhatsApp error: ${errMsg}`,
    };
  }
}

/**
 * Escalation Alert to Escalation Contact (Telegram +/or WhatsApp based on `config.escalationChannel`):
 * Sent ONLY after the Caregiver has missed both phone call attempts (or explicitly pressed/replied 3).
 */
export async function sendTier2WhatsAppNudgeToSon(
  taskId: string,
  task: Record<string, unknown>,
  config: CareConfig
): Promise<{ sent: boolean; messageSid?: string }> {
  const escChannel = config.escalationChannel || 'TELEGRAM';
  let telegramSent = false;

  if (escChannel === 'TELEGRAM' || escChannel === 'BOTH') {
    telegramSent = await sendTier2TelegramNudgeToSon(taskId, task, config);
    if (telegramSent && escChannel === 'TELEGRAM') {
      return { sent: true, messageSid: 'telegram' };
    }
  }

  const client = getTwilioClient();
  const fromWhatsApp = formatWhatsAppAddress(
    config.twilioWhatsappNumber || process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || ''
  );
  const toWhatsApp = formatWhatsAppAddress(config.escalationPhone);
  const title = String(task.title || 'Care Task');
  const reason = String(task.escalationReason || 'NO_ANSWER');

  const reasonLine =
    reason === 'PATIENT_REFUSING'
      ? `*${config.caregiverTitle}* reported that *${config.patientTitle}* is refusing *${title}*.`
      : `*${config.caregiverTitle}* has not confirmed *${title}* for *${config.patientTitle}* after WhatsApp + 2 call attempts.`;

  const bodyText =
    `🚨 *Irhamhuma Escalation Alert*\n\n` +
    `${reasonLine}\n` +
    `📞 Calling your phone now.\n\n` +
    `Reply here (or press on the call):\n` +
    `*1* — ✅ Mark Done\n` +
    `*2* — ⏳ Snooze ${config.snoozeDurationMinutes}m\n` +
    `*9* — 📲 Call ${config.caregiverTitle}'s Phone Now`;

  try {
    const msg = await client.messages.create({
      from: fromWhatsApp,
      to: toWhatsApp,
      body: bodyText,
    });
    return { sent: true, messageSid: msg.sid };
  } catch {
    return { sent: telegramSent };
  }
}

/**
 * Sends a short text-only confirmation to the Escalation Contact (via Telegram $0.00 and/or WhatsApp)
 * whenever the Caregiver marks a task as Done (if `config.notifyEscalationOnCompletion` is enabled).
 */
export async function sendCompletionWhatsAppToEscalation(
  task: Record<string, unknown>,
  completedBy: string,
  unlockedTitles: string[],
  config: CareConfig
): Promise<{ sent: boolean; messageSid?: string }> {
  if (!config.notifyEscalationOnCompletion) {
    return { sent: false };
  }

  const escChannel = config.escalationChannel || 'TELEGRAM';
  let telegramSent = false;

  if (escChannel === 'TELEGRAM' || escChannel === 'BOTH') {
    telegramSent = await sendCompletionTelegramToEscalation(
      task,
      completedBy,
      unlockedTitles,
      config
    );
    if (telegramSent && escChannel === 'TELEGRAM') {
      return { sent: true, messageSid: 'telegram' };
    }
  }

  if (!config.escalationPhone) {
    return { sent: telegramSent };
  }

  const client = getTwilioClient();
  const fromWhatsApp = formatWhatsAppAddress(
    config.twilioWhatsappNumber || process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || ''
  );
  const toWhatsApp = formatWhatsAppAddress(config.escalationPhone);
  const title = String(task.title || 'Care Task');
  const nextLine =
    unlockedTitles.length > 0
      ? `\n🔗 Next scheduled: ${unlockedTitles.join(', ')}`
      : '';

  const bodyText =
    `✅ *Irhamhuma — ${title} Done*\n` +
    `*${config.caregiverTitle}* confirmed *${title}* for *${config.patientTitle}* (${completedBy}).${nextLine}`;

  try {
    const msg = await client.messages.create({
      from: fromWhatsApp,
      to: toWhatsApp,
      body: bodyText,
    });
    return { sent: true, messageSid: msg.sid };
  } catch {
    return { sent: telegramSent };
  }
}

/**
 * Handles incoming WhatsApp replies from Caregiver or Escalation Contact (POST /twimlRouter/whatsapp-webhook).
 * Returns TwiML <MessagingResponse><Message>...</Message></MessagingResponse> in Urdu!
 */
export async function handleIncomingWhatsAppWebhook(
  body: Record<string, unknown>
): Promise<string> {
  const config = await getCareConfig();
  const db = admin.firestore();
  const rawText = String(body.Body || '').trim().toLowerCase();
  const fromRaw = String(body.From || '')
    .replace(/^whatsapp:/i, '')
    .replace(/\s+/g, '')
    .trim();

  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  // Only allow configured family phone numbers to mutate task state or trigger calls
  const allowedPhones = new Set(
    [config.caregiverPhone, config.escalationPhone, config.patientPhone]
      .map((p) => String(p || '').replace(/^whatsapp:/i, '').replace(/\s+/g, '').trim())
      .filter(Boolean)
  );
  if (!fromRaw || !allowedPhones.has(fromRaw)) {
    return twiml.toString();
  }

  // Priority 1: Find the most recently notified/active task (NOT future SCHEDULED tasks like Dinner!)
  const activeSnap = await db
    .collection('dailyTasks')
    .where('status', 'in', [
      'TIER1_NOTIFYING',
      'TIER2_NUDGING_SON',
      'CALLING_CAREGIVER',
      'ESCALATED',
      'SNOOZED',
      'RETRY_WAIT',
    ])
    .get();

  let docs = activeSnap.docs.sort((a, b) => {
    const tA = String(a.data().updatedAt || '');
    const tB = String(b.data().updatedAt || '');
    return tB.localeCompare(tA);
  });

  // Priority 2 (Fallback): If no task is currently in an active notifying state, pick the earliest due SCHEDULED task
  if (docs.length === 0) {
    const nowIso = new Date().toISOString();
    const schedSnap = await db
      .collection('dailyTasks')
      .where('status', '==', 'SCHEDULED')
      .get();
    docs = schedSnap.docs
      .filter((d) => {
        const s = d.data().scheduledAt as string | null;
        return !s || s <= nowIso;
      })
      .sort((a, b) => Number(a.data().order || 0) - Number(b.data().order || 0));
  }

  const targetDoc = docs[0];
  if (!targetDoc) {
    twiml.message(
      `🤲 السلام علیکم! اس وقت ${config.patientTitle} کی کوئی دوائی یا کھانا زیرِ التواء نہیں ہے۔ الحمد للہ!`
    );
    return twiml.toString();
  }

  const taskId = targetDoc.id;
  const task = targetDoc.data();
  const taskTitle = String(task.title || 'دوائی');
  const isFromSon =
    fromRaw &&
    config.escalationPhone.replace(/\s+/g, '') === fromRaw &&
    config.caregiverPhone.replace(/\s+/g, '') !== fromRaw;
  const actorName = isFromSon
    ? `${config.escalationName} (WhatsApp)`
    : `${config.caregiverTitle} (WhatsApp)`;

  // Parse reply choice: 1 (Done), 2 (Snooze), 3 (Refusing/Escalate), 9 (Call Now)
  const choice =
    rawText === '1' ||
    rawText.includes('done') ||
    rawText.includes('le li') ||
    rawText.includes('ho gaya') ||
    rawText.includes('لے لی')
      ? '1'
      : rawText === '2' ||
          rawText.includes('snooze') ||
          rawText.includes('baad') ||
          rawText.includes('بعد')
        ? '2'
        : rawText === '3' ||
            rawText.includes('mana') ||
            rawText.includes('refus') ||
            rawText.includes('منع')
          ? '3'
          : rawText === '9' || rawText.includes('call')
            ? '9'
            : '';

  if (choice === '1') {
    const nowIso = new Date().toISOString();
    await targetDoc.ref.update({
      status: 'COMPLETED',
      completedAt: nowIso,
      completedBy: actorName,
      updatedAt: nowIso,
    });

    // Unlock dependent AFTER_TASK items (+15m Morning Meds, +120m Boiled Eggs)
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

    const chainNote =
      unlockedTitles.length > 0
        ? `\n🔗 اگلا شیڈول سیٹ ہو گیا: ${unlockedTitles.join('، ')}`
        : '';

    if (!isFromSon && config.notifyEscalationOnCompletion) {
      await sendCompletionWhatsAppToEscalation(
        task,
        actorName,
        unlockedTitles,
        config
      );
    }

    twiml.message(
      `✅ جزاک اللہ ${config.caregiverTitle}! "${taskTitle}" مکمل ہو گیا ہے اور ریکارڈ محفوظ کر لیا گیا ہے۔ اللہ ${config.patientTitle} کو صحت کاملہ عطا فرمائے۔${chainNote}`
    );
    return twiml.toString();
  }

  if (choice === '2') {
    const snoozeMs = config.snoozeDurationMinutes * 60_000;
    await targetDoc.ref.update({
      status: 'SNOOZED',
      snoozeCount: ((task.snoozeCount as number) || 0) + 1,
      scheduledAt: new Date(Date.now() + snoozeMs).toISOString(),
      updatedAt: new Date().toISOString(),
    });

    twiml.message(
      `⏳ ٹھیک ہے ${config.caregiverTitle}، "${taskTitle}" کے لیے ${config.snoozeDurationMinutes} منٹ بعد دوبارہ یاد دہانی بھیجی جائے گی۔`
    );
    return twiml.toString();
  }

  if (choice === '3') {
    await targetDoc.ref.update({
      status: 'ESCALATED',
      escalationReason: 'PATIENT_REFUSING',
      updatedAt: new Date().toISOString(),
    });
    await sendTier2WhatsAppNudgeToSon(taskId, task, config);
    await placeOutboundCall(taskId, 'ESCALATION');

    twiml.message(
      `🚨 پریشان نہ ہوں ${config.caregiverTitle}، ابھی ${config.escalationName} کو کال جا رہی ہے تاکہ وہ ${config.patientTitle} سے بات کر سکیں!`
    );
    return twiml.toString();
  }

  if (choice === '9') {
    await targetDoc.ref.update({
      status: 'CALLING_CAREGIVER',
      attemptCount: ((task.attemptCount as number) || 0) + 1,
      updatedAt: new Date().toISOString(),
    });
    await placeOutboundCall(taskId, 'CAREGIVER');
    twiml.message(
      `📲 ابھی ${config.caregiverTitle} کے موبائل نمبر پر کال ملائی جا رہی ہے۔`
    );
    return twiml.toString();
  }

  twiml.message(
    `🤲 براہ کرم "${taskTitle}" کے لیے صرف ایک نمبر لکھ کر جواب دیں:\n` +
      `*1* — ✅ مکمل ہو گیا (Done)\n` +
      `*2* — ⏳ ${config.snoozeDurationMinutes} منٹ بعد (Snooze)\n` +
      `*3* — 🚨 ${config.escalationName} کو کال کریں`
  );
  return twiml.toString();
}
