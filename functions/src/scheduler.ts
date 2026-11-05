import * as admin from 'firebase-admin';
import { sendTier1TelegramAlertToCaregiver } from './telegram-service';
import { getCareConfig, placeOutboundCall } from './voice-webhooks';
import {
  sendTier1WhatsAppToCaregiver,
  sendTier2WhatsAppNudgeToSon,
} from './whatsapp-service';

interface DefaultTemplateSeed {
  id: string;
  title: string;
  category: 'MEAL' | 'MEDICATION' | 'SNACK' | 'HYDRATION';
  triggerType: 'FIXED_TIME' | 'AFTER_TASK';
  fixedTime: string | null;
  parentTemplateId: string | null;
  offsetMinutes: number | null;
  instructions: string;
  urduScript: string;
  urduScriptNative: string;
  order: number;
  active: boolean;
}

const DEFAULT_SERVER_TEMPLATES: DefaultTemplateSeed[] = [
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
    order: 5,
    active: true,
  },
];

export function getPakistanDateKey(nowMs = Date.now()): string {
  // Asia/Karachi is UTC+05:00 all year round (no DST)
  const pktDate = new Date(nowMs + 5 * 3600_000);
  return pktDate.toISOString().slice(0, 10);
}

export function pktTimeToUtcIso(pktDateKey: string, fixedTimeHHMM: string): string {
  const cleanTime = fixedTimeHHMM.trim().slice(0, 5);
  const parsed = new Date(`${pktDateKey}T${cleanTime}:00+05:00`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

/**
 * Ensures today's dailyTasks exist in Firestore for Pakistan date (`Asia/Karachi`, UTC+5).
 * Automatically runs on the 1-minute Cloud Scheduler tick so the schedule works 24/7
 * even if no browser tab is open!
 */
export async function ensureTodayTasksSeededInFirestore(
  db: admin.firestore.Firestore,
  nowMs = Date.now()
): Promise<string> {
  const pktDateKey = getPakistanDateKey(nowMs);
  const existingSnap = await db
    .collection('dailyTasks')
    .where('dateKey', '==', pktDateKey)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    // Normalize any existing tasks whose scheduledAt is a bare "HH:mm" string instead of UTC ISO
    const allTodaySnap = await db
      .collection('dailyTasks')
      .where('dateKey', '==', pktDateKey)
      .get();

    const uncompletedParentIds = new Set<string>();
    for (const doc of allTodaySnap.docs) {
      const td = doc.data();
      if (td.status !== 'COMPLETED' && td.templateId) {
        uncompletedParentIds.add(String(td.templateId));
      }
    }

    const fixBatch = db.batch();
    let needsFix = false;
    for (const doc of allTodaySnap.docs) {
      const d = doc.data();
      const sched = d.scheduledAt as string | null;
      let normalizedIso = sched;
      if (sched && /^\d{2}:\d{2}$/.test(sched)) {
        normalizedIso = pktTimeToUtcIso(pktDateKey, sched);
        fixBatch.update(doc.ref, {
          scheduledAt: normalizedIso,
        });
        needsFix = true;
      }

      // Auto-expire any stale task whose scheduledAt is >25 minutes in the past so old tasks never blast out late
      if (
        normalizedIso &&
        d.triggerType === 'FIXED_TIME' &&
        ['SCHEDULED', 'TIER1_NOTIFYING', 'TIER2_NUDGING_SON'].includes(String(d.status)) &&
        new Date(normalizedIso).getTime() < nowMs - 25 * 60_000
      ) {
        fixBatch.update(doc.ref, {
          status: 'COMPLETED',
          completedAt: new Date(nowMs).toISOString(),
          completedBy: 'Auto-Expired (Unconfirmed)',
        });
        needsFix = true;
      }

      // Repair any future FIXED_TIME meal that was accidentally marked COMPLETED via WhatsApp >20 mins before its scheduled time
      if (
        normalizedIso &&
        d.triggerType === 'FIXED_TIME' &&
        d.status === 'COMPLETED' &&
        String(d.completedBy || '').includes('WhatsApp') &&
        new Date(normalizedIso).getTime() > nowMs + 20 * 60_000
      ) {
        fixBatch.update(doc.ref, {
          status: 'SCHEDULED',
          completedAt: null,
          completedBy: null,
        });
        uncompletedParentIds.add(String(d.templateId || ''));
        needsFix = true;
      }

      // Generic Parent-Child Guard: If an AFTER_TASK item is SCHEDULED while its parent task is still not COMPLETED, reset to WAITING_FOR_PARENT
      if (
        d.triggerType === 'AFTER_TASK' &&
        d.parentTemplateId &&
        d.status === 'SCHEDULED' &&
        uncompletedParentIds.has(String(d.parentTemplateId))
      ) {
        fixBatch.update(doc.ref, {
          status: 'WAITING_FOR_PARENT',
          scheduledAt: null,
        });
        needsFix = true;
      }
    }
    if (needsFix) {
      await fixBatch.commit();
    }
    return pktDateKey;
  }

  // Load custom templates from settings/scheduleTemplates if saved, else use DEFAULT_SERVER_TEMPLATES
  const tplDoc = await db.doc('settings/scheduleTemplates').get();
  const templates: DefaultTemplateSeed[] =
    tplDoc.exists && Array.isArray(tplDoc.data()?.items) && tplDoc.data()!.items.length > 0
      ? (tplDoc.data()!.items as DefaultTemplateSeed[])
      : DEFAULT_SERVER_TEMPLATES;

  const batch = db.batch();
  for (const tpl of templates.filter((t) => t.active !== false)) {
    const isFixed = tpl.triggerType === 'FIXED_TIME' && Boolean(tpl.fixedTime);
    const docId = `${pktDateKey}_${tpl.id}`;
    const docRef = db.collection('dailyTasks').doc(docId);

    let scheduledAtIso: string | null = null;
    if (isFixed && tpl.fixedTime) {
      scheduledAtIso = pktTimeToUtcIso(pktDateKey, tpl.fixedTime);
    }

    // If seeding mid-day and a fixed-time task is already >20 mins in the past, mark it so it doesn't fire retroactively
    const isAlreadyPast =
      scheduledAtIso !== null &&
      new Date(scheduledAtIso).getTime() < nowMs - 20 * 60_000;

    batch.set(docRef, {
      id: docId,
      templateId: tpl.id,
      dateKey: pktDateKey,
      title: tpl.title,
      category: tpl.category,
      triggerType: tpl.triggerType,
      fixedTime: tpl.fixedTime,
      parentTemplateId: tpl.parentTemplateId,
      offsetMinutes: tpl.offsetMinutes,
      instructions: tpl.instructions,
      urduScript: tpl.urduScript,
      urduScriptNative: tpl.urduScriptNative,
      order: tpl.order,
      status: isFixed ? (isAlreadyPast ? 'COMPLETED' : 'SCHEDULED') : 'WAITING_FOR_PARENT',
      scheduledAt: scheduledAtIso,
      scheduledTimeDisplay: isFixed
        ? `${tpl.fixedTime} PKT`
        : `+${tpl.offsetMinutes ?? 15}m after ${tpl.parentTemplateId}`,
      attemptCount: 0,
      snoozeCount: 0,
      escalationReason: 'NONE',
      completedAt: isAlreadyPast ? new Date(nowMs).toISOString() : null,
      completedBy: isAlreadyPast ? 'Auto-Seeded (Past Time)' : null,
      updatedAt: new Date(nowMs).toISOString(),
    });
  }

  await batch.commit();
  return pktDateKey;
}

/**
 * Runs every 1 minute via Cloud Scheduler.
 * Implements the Caregiver-First Cascade:
 * - Step 1 (Minute 0 — SCHEDULED / SNOOZED): Sends WhatsApp Summary + Native Urdu MP3 Voice Note to Caregiver (TIER1_NOTIFYING)
 * - Step 2 (Minute 5 — TIER1_NOTIFYING -> CALLING_CAREGIVER): Calls Caregiver (Attempt #1: WhatsApp Call with automatic Cellular fallback; Attempt #2 after 5m: Cellular Call)
 * - Step 3 (After 2 unanswered Caregiver calls -> ESCALATED): Sends Escalation WhatsApp + Escalation Call to Escalation Contact
 */
export async function processDueDailyTasks(): Promise<number> {
  const db = admin.firestore();
  const config = await getCareConfig();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Ensure today's PKT schedule is seeded and normalized in Firestore
  const pktDateKey = await ensureTodayTasksSeededInFirestore(db, nowMs);

  let triggeredCount = 0;

  // 1. Handle tasks due at Minute 0 (SCHEDULED, SNOOZED, RETRY_WAIT) for today
  const dueSnap = await db
    .collection('dailyTasks')
    .where('dateKey', '==', pktDateKey)
    .where('status', 'in', ['SCHEDULED', 'SNOOZED', 'RETRY_WAIT'])
    .get();

  for (const docSnap of dueSnap.docs) {
    const task = docSnap.data();
    const schedIso = task.scheduledAt as string | null;
    if (!schedIso || schedIso > nowIso) {
      continue;
    }

    // Guard: Never fire a FIXED_TIME task if its scheduled time was more than 25 minutes ago!
    const schedMs = new Date(schedIso).getTime();
    if (task.status === 'SCHEDULED' && nowMs - schedMs > 25 * 60_000) {
      await docSnap.ref.update({
        status: 'COMPLETED',
        completedAt: nowIso,
        completedBy: 'Auto-Skipped (Past Window)',
        updatedAt: nowIso,
      });
      continue;
    }

    if (task.status === 'RETRY_WAIT' || !config.enableCostSaverCascade) {
      const nextAttempt = ((task.attemptCount as number) || 0) + 1;
      await docSnap.ref.update({
        status: 'CALLING_CAREGIVER',
        attemptCount: nextAttempt,
        updatedAt: nowIso,
      });
      await placeOutboundCall(docSnap.id, 'CAREGIVER', {
        forceCellular: task.status === 'RETRY_WAIT',
      });
      triggeredCount++;
      break; // Max 1 task notification per tick so multiple alerts never fire simultaneously
    } else {
      // Enter Step 1 (WhatsApp / Telegram + Kiosk to Caregiver first — no alert to Escalation Contact yet!)
      await docSnap.ref.update({
        status: 'TIER1_NOTIFYING',
        tier1StartedAt: nowIso,
        updatedAt: nowIso,
      });
      const cgChannel = config.caregiverChannel || 'WHATSAPP';
      if (cgChannel === 'TELEGRAM') {
        await sendTier1TelegramAlertToCaregiver(docSnap.id, task, config);
      } else if (cgChannel === 'BOTH') {
        await Promise.all([
          sendTier1WhatsAppToCaregiver(docSnap.id, task, config),
          sendTier1TelegramAlertToCaregiver(docSnap.id, task, config),
        ]);
      } else {
        const waRes = await sendTier1WhatsAppToCaregiver(docSnap.id, task, config);
        if (!waRes.sent) {
          await docSnap.ref.update({
            tier1DeliveryError: waRes.details,
          });
        }
      }
      triggeredCount++;
      break; // Max 1 task notification per tick so multiple alerts never fire simultaneously
    }
  }

  // 2. Check active Tier 1 tasks -> Call Caregiver directly at Minute 5 (without prematurely alerting Escalation Contact at Minute 3)
  const tier1Snap = await db
    .collection('dailyTasks')
    .where('status', 'in', ['TIER1_NOTIFYING', 'TIER2_NUDGING_SON'])
    .get();

  for (const docSnap of tier1Snap.docs) {
    const task = docSnap.data();
    const startedMs = task.tier1StartedAt
      ? new Date(task.tier1StartedAt as string).getTime()
      : nowMs;
    const elapsedMinutes = (nowMs - startedMs) / 60_000;

    if (elapsedMinutes >= config.tier3TwilioFallbackAfterMinutes) {
      if (!config.enableTwilioCalls) {
        // Twilio calls disabled: Escalate via $0 Telegram / WhatsApp message only (zero phone calls!)
        await docSnap.ref.update({
          status: 'ESCALATED',
          escalationReason: 'NO_ANSWER',
          updatedAt: nowIso,
        });
        await sendTier2WhatsAppNudgeToSon(
          docSnap.id,
          { ...task, escalationReason: 'NO_ANSWER' },
          config
        );
        triggeredCount++;
        continue;
      }

      const nextAttempt = ((task.attemptCount as number) || 0) + 1;
      await docSnap.ref.update({
        status: 'CALLING_CAREGIVER',
        attemptCount: nextAttempt,
        updatedAt: nowIso,
      });
      try {
        await placeOutboundCall(docSnap.id, 'CAREGIVER');
      } catch {
        // Prevent scheduler crash if Twilio is out of credits or unreachable
      }
      triggeredCount++;
    }
  }

  return triggeredCount;
}

/**
 * Handles Twilio Call Status Webhook (`no-answer`, `busy`, `failed`, or `completed` without input)
 */
export async function handleCallStatusWebhook(
  taskId: string,
  role: string,
  callStatus: string,
  channel?: string
): Promise<void> {
  if (role !== 'CAREGIVER') return;

  const config = await getCareConfig();
  const taskRef = admin.firestore().doc(`dailyTasks/${taskId}`);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) return;

  const task = taskSnap.data()!;
  if (['COMPLETED', 'SNOOZED', 'ESCALATED', 'BRIDGED'].includes(task.status)) {
    return;
  }

  // If the WhatsApp Voice Call failed at the network/permission level without ringing,
  // immediately fall back to a regular PSTN cellular call on the same attempt!
  if (channel === 'whatsapp' && ['failed', 'canceled'].includes(callStatus)) {
    await placeOutboundCall(taskId, 'CAREGIVER', { forceCellular: true });
    return;
  }

  if (['no-answer', 'busy', 'failed', 'completed'].includes(callStatus)) {
    if (((task.attemptCount as number) || 1) < 2) {
      const retryMs = config.retryDelayMinutes * 60_000;
      await taskRef.update({
        status: 'RETRY_WAIT',
        scheduledAt: new Date(Date.now() + retryMs).toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      await taskRef.update({
        status: 'ESCALATED',
        escalationReason: 'NO_ANSWER',
        updatedAt: new Date().toISOString(),
      });
      await sendTier2WhatsAppNudgeToSon(
        taskId,
        { ...task, escalationReason: 'NO_ANSWER' },
        config
      );
      await placeOutboundCall(taskId, 'ESCALATION');
    }
  }
}
