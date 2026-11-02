import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { CareConfig } from './schemas';
import { getBaseRouterUrl, getCareConfig, placeOutboundCall } from './voice-webhooks';

/**
 * Generates a deterministic 48-char webhook secret token from the bot token and dashboard key
 * so Telegram signs every webhook request with `X-Telegram-Bot-Api-Secret-Token`.
 */
export function getTelegramWebhookSecret(rawToken?: string): string {
  const token = (rawToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return '';
  const salt = (process.env.DASHBOARD_API_KEY || 'irhamhuma-tg-secret').trim();
  return crypto
    .createHmac('sha256', `${token}:${salt}`)
    .update('irhamhuma-telegram-webhook-v1')
    .digest('hex')
    .slice(0, 48);
}

export function hasValidTelegramWebhookSecret(
  headerSecret: string | undefined,
  botToken: string
): boolean {
  const expected = getTelegramWebhookSecret(botToken);
  if (!expected || !headerSecret) return false;
  const a = Buffer.from(headerSecret.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Tier 1 ($0.00 Cost at Minute 0):
 * Sends the Native Urdu Voice Note + 1-Tap Urdu Inline Buttons to the caregiver on Telegram,
 * and optionally triggers a Free CallMeBot Telegram Voice Call!
 */
export async function sendTier1TelegramAlertToCaregiver(
  taskId: string,
  task: Record<string, unknown>,
  config: CareConfig
): Promise<{ sent: boolean; details: string }> {
  const botToken = (config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (config.caregiverTelegramChatId || '').trim();
  const baseUrl = getBaseRouterUrl();
  const audioStreamUrl = `${baseUrl}/audio?taskId=${encodeURIComponent(taskId)}&type=caregiver`;

  const results: string[] = [];

  // 1. Optional Free CallMeBot Telegram Ringing Call
  if (config.enableCallMeBotVoiceCall && config.caregiverTelegramUsername) {
    const username = config.caregiverTelegramUsername.trim();
    const callMeBotUrl = `https://api.callmebot.com/start.php?user=${encodeURIComponent(username)}&file=${encodeURIComponent(audioStreamUrl)}&cc=yes`;
    try {
      await fetch(callMeBotUrl);
      results.push(`CallMeBot free Telegram call triggered for ${username}`);
    } catch {
      results.push('CallMeBot call attempt failed');
    }
  }

  if (!botToken || !chatId) {
    return {
      sent: results.length > 0,
      details:
        results.join('; ') ||
        'Telegram Bot Token or Caregiver Chat ID not configured yet in Settings.',
    };
  }

  const title = String(task.title || 'Care Task');
  const instructions = String(task.instructions || '');
  const urduNative = String(
    task.urduScriptNative ||
      `السلام علیکم ${config.caregiverTitle}! ${config.patientTitle} کے ${title} کا وقت ہو گیا ہے۔`
  );

  // Send Voice / Audio MP3 first so Caregiver can tap play and hear Native Urdu
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendAudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        audio: audioStreamUrl,
        title: `${config.patientTitle} — ${title}`,
        caption: `🔊 ${urduNative}\n\n📋 *${title}*: ${instructions}`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `✅ جی، ${config.patientTitle} نے لے لی (Done)`,
                callback_data: `DONE:${taskId}`,
              },
            ],
            [
              {
                text: `⏳ ${config.snoozeDurationMinutes} منٹ بعد یاد دلائیں (Snooze)`,
                callback_data: `SNOOZE:${taskId}`,
              },
            ],
            [
              {
                text: `🚨 ${config.patientTitle} منع کر رہے ہیں — ${config.escalationName} کو بلائیں`,
                callback_data: `REFUSE:${taskId}`,
              },
            ],
          ],
        },
      }),
    });
    results.push(`Telegram Urdu Audio + 1-Tap Buttons sent to ${config.caregiverTitle}`);
    return { sent: true, details: results.join('; ') };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Telegram send failed';
    return { sent: false, details: msg };
  }
}

/**
 * Automatically registers the Telegram Bot Webhook URL (`/telegram-webhook`)
 * when a Bot Token is saved in Settings so `/start` and inline buttons work immediately.
 */
export async function ensureTelegramWebhookRegistered(
  rawToken?: string
): Promise<boolean> {
  const token = (rawToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return false;
  const webhookUrl = `${getBaseRouterUrl()}/telegram-webhook`;
  const secretToken = getTelegramWebhookSecret(token);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: secretToken,
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sends a short text-only Telegram confirmation ($0.00 cost, no 24h window restriction)
 * to the Escalation Contact whenever the Caregiver confirms a task.
 */
export async function sendCompletionTelegramToEscalation(
  task: Record<string, unknown>,
  completedBy: string,
  unlockedTitles: string[],
  config: CareConfig
): Promise<boolean> {
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

  if (!botToken || !sonChatId) {
    return false;
  }

  const title = String(task.title || 'Care Task');
  const nextLine =
    unlockedTitles.length > 0
      ? `\n🔗 Next scheduled: ${unlockedTitles.join(', ')}`
      : '';

  const text =
    `✅ *Irhamhuma — ${title} Done*\n` +
    `*${config.caregiverTitle}* confirmed *${title}* for *${config.patientTitle}* (${completedBy}).${nextLine}`;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: sonChatId,
          text,
          parse_mode: 'Markdown',
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Escalation Alert ($0.00 Cost on Telegram):
 * Alerts the Escalation Contact on Telegram when the caregiver has missed both phone call attempts
 * or pressed/replied 3 (patient refusing), with 1-tap inline action buttons.
 */
export async function sendTier2TelegramNudgeToSon(
  taskId: string,
  task: Record<string, unknown>,
  config: CareConfig
): Promise<boolean> {
  const botToken = (config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const sonChatId = (
    config.escalationTelegramChatId ||
    process.env.ESCALATION_TELEGRAM_CHAT_ID ||
    config.caregiverTelegramChatId ||
    ''
  ).trim();

  if (!botToken || !sonChatId) {
    return false;
  }

  const title = String(task.title || 'Care Task');
  const reason = String(task.escalationReason || 'NO_ANSWER');
  const reasonLine =
    reason === 'PATIENT_REFUSING'
      ? `*${config.caregiverTitle}* reported that *${config.patientTitle}* is refusing *${title}*.`
      : `*${config.caregiverTitle}* has not confirmed *${title}* for *${config.patientTitle}* after 2 call attempts.`;

  const text =
    `🚨 *Irhamhuma Escalation Alert*\n\n` +
    `${reasonLine}\n` +
    `📞 Calling your phone now (or tap an action below):`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: sonChatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Mark Done',
                callback_data: `DONE:${taskId}`,
              },
            ],
            [
              {
                text: `⏳ Snooze ${config.snoozeDurationMinutes}m`,
                callback_data: `SNOOZE:${taskId}`,
              },
              {
                text: `📲 Call ${config.caregiverTitle} Now`,
                callback_data: `TWILIO_NOW:${taskId}`,
              },
            ],
          ],
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Processes incoming Telegram Bot Webhook updates (/start for Chat ID discovery + Inline Button presses)
 */
export async function handleTelegramBotWebhook(
  update: Record<string, unknown>,
  secretHeader?: string
): Promise<boolean> {
  const config = await getCareConfig();
  const botToken = (config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) return false;

  // Verify Telegram's X-Telegram-Bot-Api-Secret-Token header to prevent spoofed webhook requests
  if (!hasValidTelegramWebhookSecret(secretHeader, botToken)) {
    return false;
  }

  // 1. Handle /start message to show the user their Chat ID
  const message = update.message as
    | { chat?: { id: number; first_name?: string }; text?: string }
    | undefined;
  if (message?.chat?.id && message.text?.startsWith('/start')) {
    const chatId = message.chat.id;
    const name = message.chat.first_name || 'Family Member';
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          `🤲 *Assalam-o-Alaikum ${name}! Welcome to Irhamhuma (رَّبِّ ارْحَمْهُمَا)*\n\n` +
          `Your Telegram Chat ID is:\n\`${chatId}\`\n\n` +
          `Copy and paste this Chat ID into *Settings* in your Irhamhuma dashboard to receive free Urdu voice reminders and 1-tap confirmation buttons!`,
        parse_mode: 'Markdown',
      }),
    });
    return true;
  }

  // 2. Handle 1-Tap Inline Button Callback Queries (DONE, SNOOZE, REFUSE, TWILIO_NOW)
  const callbackQuery = update.callback_query as
    | {
        id: string;
        data?: string;
        from?: { id?: number; first_name?: string };
        message?: { chat?: { id: number }; message_id?: number };
      }
    | undefined;

  if (!callbackQuery?.data) return true;

  // Verify the sender Chat ID is an authorized Caregiver or Escalation family member
  const senderChatId = String(
    callbackQuery.message?.chat?.id ?? callbackQuery.from?.id ?? ''
  ).trim();
  const allowedChatIds = new Set(
    [
      config.caregiverTelegramChatId,
      config.escalationTelegramChatId,
      process.env.ESCALATION_TELEGRAM_CHAT_ID,
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  if (!senderChatId || !allowedChatIds.has(senderChatId)) {
    return false;
  }

  const [action, taskId] = callbackQuery.data.split(':');
  if (!taskId) return true;

  const db = admin.firestore();
  const taskRef = db.doc(`dailyTasks/${taskId}`);
  const taskSnap = await taskRef.get();
  const task = taskSnap.data() || {};
  const actorName = callbackQuery.from?.first_name || config.caregiverTitle;

  let feedbackText = '';

  if (action === 'DONE') {
    const nowIso = new Date().toISOString();
    await taskRef.update({
      status: 'COMPLETED',
      completedAt: nowIso,
      completedBy: `${actorName} (Telegram)`,
    });

    // Unlock dependent AFTER_TASK items (+15m Meds, +120m Boiled Eggs)
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

    const fromChatId = String(callbackQuery.message?.chat?.id || '');
    const escChatId = String(config.escalationTelegramChatId || '').trim();
    if (config.notifyEscalationOnCompletion && escChatId && fromChatId !== escChatId) {
      await sendCompletionTelegramToEscalation(
        task,
        `${actorName} (Telegram)`,
        unlockedTitles,
        config
      );
    }

    feedbackText = `✅ جزاک اللہ! "${task.title || taskId}" مکمل ہو گیا ہے اور ریکارڈ محفوظ کر لیا گیا ہے۔`;
  } else if (action === 'SNOOZE') {
    const snoozeMs = config.snoozeDurationMinutes * 60_000;
    await taskRef.update({
      status: 'SNOOZED',
      snoozeCount: ((task.snoozeCount as number) || 0) + 1,
      scheduledAt: new Date(Date.now() + snoozeMs).toISOString(),
    });
    feedbackText = `⏳ ٹھیک ہے، ${config.snoozeDurationMinutes} منٹ بعد دوبارہ یاد دلایا جائے گا۔`;
  } else if (action === 'REFUSE') {
    await taskRef.update({
      status: 'ESCALATED',
      escalationReason: 'PATIENT_REFUSING',
    });
    await sendTier2TelegramNudgeToSon(taskId, task, config);
    await placeOutboundCall(taskId, 'ESCALATION');
    feedbackText = `🚨 پریشان نہ ہوں ${config.caregiverTitle}، ابھی ${config.escalationName} کو کال جا رہی ہے!`;
  } else if (action === 'TWILIO_NOW') {
    await taskRef.update({
      status: 'CALLING_CAREGIVER',
      attemptCount: ((task.attemptCount as number) || 0) + 1,
    });
    await placeOutboundCall(taskId, 'CAREGIVER');
    feedbackText = `📲 Placing live Twilio PSTN call to ${config.caregiverTitle} now...`;
  }

  // Acknowledge the callback query on Telegram
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: feedbackText,
    }),
  });

  if (callbackQuery.message?.chat?.id && feedbackText) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: callbackQuery.message.chat.id,
        text: feedbackText,
      }),
    });
  }
  return true;
}
