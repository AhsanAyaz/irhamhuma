import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { HttpsError, onRequest, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import twilio from 'twilio';
import {
  parseScheduleWithGemini,
  synthesizeAndCacheTaskAudio,
} from './ai-service';
import {
  buildCaregiverPromptTwiml,
  buildEscalationPromptTwiml,
  buildUrduAudioMp3ForTwilio,
  getBaseRouterUrl,
  getCareConfig,
  handleCaregiverGatherTwiml,
  handleEscalationGatherTwiml,
  syncAndTriggerLiveCall,
} from './voice-webhooks';
import {
  getPakistanDateKey,
  handleCallStatusWebhook,
  pktTimeToUtcIso,
  processDueDailyTasks,
} from './scheduler';
import {
  handleIncomingWhatsAppWebhook,
  handleMetaWhatsAppWebhookPost,
  sendCompletionWhatsAppToEscalation,
  sendTier1WhatsAppToCaregiver,
  verifyMetaWhatsAppWebhookGet,
} from './whatsapp-service';
import {
  ensureTelegramWebhookRegistered,
  handleTelegramBotWebhook,
  sendTier1TelegramAlertToCaregiver,
} from './telegram-service';
import { CareConfigSchema, UrduVoiceNameSchema } from './schemas';

admin.initializeApp();

const DEPRECATED_GENERIC_TEMPLATE_IDS = new Set([
  'morning_meds',
  'boiled_eggs',
  'afternoon_meds',
  'evening_tea',
  'evening_milkshake',
  'night_meds',
]);

function hasValidDashboardAuth(headerKey: string | undefined): boolean {
  const expected = process.env.DASHBOARD_API_KEY;
  if (!expected || !headerKey) return false;
  const a = Buffer.from(headerKey.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hasValidTwilioSignature(
  signature: string | undefined,
  pathAndQuery: string,
  originalUrl: string,
  hostHeader: string | undefined,
  body: Record<string, unknown>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) return false;

  const baseUrl = getBaseRouterUrl();

  const candidateUrls = new Set<string>([
    `${baseUrl}${pathAndQuery}`,
    `${baseUrl}${originalUrl.replace(/^\/twimlRouter/, '')}`,
  ]);
  if (hostHeader) {
    candidateUrls.add(`https://${hostHeader}${originalUrl}`);
    candidateUrls.add(`https://${hostHeader}/twimlRouter${pathAndQuery}`);
  }

  const params = body && typeof body === 'object' ? body : {};
  for (const url of candidateUrls) {
    if (twilio.validateRequest(authToken, signature, url, params)) {
      return true;
    }
  }
  return false;
}

/**
 * 1. Cloud Scheduler Trigger (Every 1 Minute)
 * Dispatches 3-Tier Cascade (Min 0 WhatsApp + Urdu Audio -> Min 3 Son Nudge -> Min 5 Twilio PSTN Call)
 */
export const tickCareScheduler = onSchedule('every 1 minutes', async () => {
  await processDueDailyTasks();
});

/**
 * 2. Unified Voice, Audio & WhatsApp Webhook Router (/twimlRouter/*)
 */
export const twimlRouter = onRequest({ cors: true }, async (req, res) => {
  try {
    const path = req.path;
    const taskId = String(req.query.taskId || '');

    // Stream 100% Native Urdu MP3 synthesized via Google Cloud TTS WaveNet / Standard PK
    if (path.endsWith('/audio') || path.endsWith('/audio.mp3')) {
      const audioType = String(req.query.type || 'caregiver');
      const customText = req.query.text ? String(req.query.text) : undefined;
      if (customText && customText.length > 400) {
        res.status(400).send('Text exceeds 400 character limit.');
        return;
      }
      const voiceOverride = req.query.voice
        ? UrduVoiceNameSchema.parse(String(req.query.voice))
        : undefined;
      const mp3Buffer = await buildUrduAudioMp3ForTwilio(
        taskId,
        audioType,
        customText,
        voiceOverride
      );
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=3600');
      res.status(200).send(mp3Buffer);
      return;
    }

    // Sync config, schedule templates, and today's dailyTasks between Web Dashboard and Firestore
    if (path.endsWith('/sync-state')) {
      if (!hasValidDashboardAuth(req.header('x-irhamhuma-key'))) {
        res.status(401).json({ ok: false, error: 'Unauthorized: valid x-irhamhuma-key header required.' });
        return;
      }

      const db = admin.firestore();
      const { config, templates, dailyTasks, forceOverwriteTasks, pullOnly } = (req.body || {}) as {
        config?: Record<string, unknown>;
        templates?: Array<Record<string, unknown>>;
        dailyTasks?: Array<Record<string, unknown>>;
        forceOverwriteTasks?: boolean;
        pullOnly?: boolean;
      };

      const pktDateKey = getPakistanDateKey();
      const nowMs = Date.now();

      if (!pullOnly) {
        if (config) {
          const parsedConfig = CareConfigSchema.parse(config);
          await db.doc('settings/careConfig').set(parsedConfig, { merge: true });
          if (parsedConfig.telegramBotToken) {
            await ensureTelegramWebhookRegistered(parsedConfig.telegramBotToken);
          }
        }

        if (Array.isArray(templates) && templates.length > 0) {
          const cleanTemplates = templates.filter(
            (tpl) => !DEPRECATED_GENERIC_TEMPLATE_IDS.has(String(tpl.id || ''))
          );
          if (cleanTemplates.length > 0) {
            await db.doc('settings/scheduleTemplates').set(
              {
                items: cleanTemplates,
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            );
          }
        }

        if (Array.isArray(dailyTasks) && dailyTasks.length > 0) {
          const existingSnap = await db
            .collection('dailyTasks')
            .where('dateKey', '==', pktDateKey)
            .get();
          const existingMap = new Map<string, Record<string, unknown>>();
          for (const doc of existingSnap.docs) {
            existingMap.set(doc.id, doc.data());
          }

          const batch = db.batch();
          for (const t of dailyTasks) {
            const tplId = String(t.templateId || '');
            if (DEPRECATED_GENERIC_TEMPLATE_IDS.has(tplId)) {
              continue;
            }
            const docId = String(t.id || `${pktDateKey}_${tplId}`);
            const existing = existingMap.get(docId);

            const rawSched = t.scheduledAt as string | null;
            const fixedTime = t.fixedTime as string | null;
            let normalizedSched = rawSched;
            if (rawSched && /^\d{2}:\d{2}$/.test(rawSched)) {
              normalizedSched = pktTimeToUtcIso(pktDateKey, rawSched);
            } else if (!rawSched && t.triggerType === 'FIXED_TIME' && fixedTime) {
              normalizedSched = pktTimeToUtcIso(pktDateKey, fixedTime);
            }

            const isPastWindow =
              normalizedSched !== null &&
              t.triggerType === 'FIXED_TIME' &&
              new Date(normalizedSched).getTime() < nowMs - 25 * 60_000;

            if (existing && !forceOverwriteTasks) {
              const shouldMarkCompleted =
                t.status === 'COMPLETED' ||
                (isPastWindow &&
                  ['SCHEDULED', 'TIER1_NOTIFYING', 'TIER2_NUDGING_SON'].includes(
                    String(existing.status)
                  ));
              const nextStatus = shouldMarkCompleted ? 'COMPLETED' : existing.status;
              const resolvedCompletedBy =
                t.status === 'COMPLETED'
                  ? String(t.completedBy || existing.completedBy || 'Web Dashboard')
                  : String(existing.completedBy || '');

              batch.set(
                db.collection('dailyTasks').doc(docId),
                {
                  title: t.title,
                  instructions: t.instructions,
                  urduScript: t.urduScript,
                  urduScriptNative: t.urduScriptNative,
                  order: t.order,
                  status: nextStatus,
                  completedAt:
                    t.status === 'COMPLETED'
                      ? t.completedAt || existing.completedAt || new Date(nowMs).toISOString()
                      : existing.completedAt,
                  completedBy:
                    t.status === 'COMPLETED'
                      ? resolvedCompletedBy
                      : existing.completedBy,
                },
                { merge: true }
              );

              if (
                existing.status !== 'COMPLETED' &&
                t.status === 'COMPLETED' &&
                !resolvedCompletedBy.startsWith('Auto-') &&
                resolvedCompletedBy !== 'Web Dashboard'
              ) {
                const activeCfg = await getCareConfig();
                if (activeCfg.notifyEscalationOnCompletion) {
                  await sendCompletionWhatsAppToEscalation(
                    t,
                    resolvedCompletedBy,
                    [],
                    activeCfg
                  );
                }
              }
            } else {
              batch.set(
                db.collection('dailyTasks').doc(docId),
                {
                  ...t,
                  id: docId,
                  dateKey: pktDateKey,
                  status:
                    isPastWindow && t.status === 'SCHEDULED' ? 'COMPLETED' : t.status,
                  completedBy:
                    isPastWindow && t.status === 'SCHEDULED'
                      ? 'Auto-Expired (Unconfirmed)'
                      : t.completedBy ?? null,
                  scheduledAt: normalizedSched,
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              );
            }
          }
          await batch.commit();
        }
      }

      // Fetch authoritative careConfig, scheduleTemplates, and today's dailyTasks from Firestore
      const [configSnap, tplSnap, latestSnap] = await Promise.all([
        db.doc('settings/careConfig').get(),
        db.doc('settings/scheduleTemplates').get(),
        db.collection('dailyTasks').where('dateKey', '==', pktDateKey).get(),
      ]);

      const cloudConfig = configSnap.exists ? CareConfigSchema.parse(configSnap.data()) : await getCareConfig();
      const cloudTemplates =
        tplSnap.exists && Array.isArray(tplSnap.data()?.items)
          ? tplSnap.data()!.items
          : [];
      const cloudTasks = latestSnap.docs
        .map((d) => d.data())
        .filter((d) => !DEPRECATED_GENERIC_TEMPLATE_IDS.has(String(d.templateId || '')));

      res.status(200).json({
        ok: true,
        config: cloudConfig,
        templates: cloudTemplates,
        dailyTasks: cloudTasks,
      });
      return;
    }

    // Trigger a live Twilio PSTN call from the web dashboard (Protected by Dashboard API Key)
    if (path.endsWith('/trigger-live-call')) {
      if (!hasValidDashboardAuth(req.header('x-irhamhuma-key'))) {
        res.status(401).json({ ok: false, error: 'Unauthorized: valid x-irhamhuma-key header required.' });
        return;
      }
      const result = await syncAndTriggerLiveCall(req.body);
      res.status(200).json({ ok: true, ...result });
      return;
    }

    // Trigger a Tier-1 WhatsApp message + Native Urdu MP3 Voice Note from the web dashboard
    if (path.endsWith('/trigger-whatsapp')) {
      if (!hasValidDashboardAuth(req.header('x-irhamhuma-key'))) {
        res.status(401).json({ ok: false, error: 'Unauthorized: valid x-irhamhuma-key header required.' });
        return;
      }
      const { task } = (req.body || {}) as {
        task: Record<string, unknown>;
      };
      const authoritativeConfig = await getCareConfig();
      const tId = String(task?.id || `wa_${Date.now()}`);
      await admin.firestore().doc(`dailyTasks/${tId}`).set(
        {
          status: 'TIER1_NOTIFYING',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      const waResult = await sendTier1WhatsAppToCaregiver(tId, task || {}, authoritativeConfig);
      res.status(200).json({ ok: waResult.sent, ...waResult });
      return;
    }

    // Optional Telegram trigger endpoint (Protected by Dashboard API Key)
    if (path.endsWith('/trigger-telegram')) {
      if (!hasValidDashboardAuth(req.header('x-irhamhuma-key'))) {
        res.status(401).json({ ok: false, error: 'Unauthorized: valid x-irhamhuma-key header required.' });
        return;
      }
      const { task } = (req.body || {}) as {
        task: Record<string, unknown>;
      };
      const authoritativeConfig = await getCareConfig();
      const tId = String(task?.id || `tg_${Date.now()}`);
      const tgResult = await sendTier1TelegramAlertToCaregiver(tId, task || {}, authoritativeConfig);
      res.status(200).json({ ok: tgResult.sent, ...tgResult });
      return;
    }

    if (path.endsWith('/telegram-webhook')) {
      const ok = await handleTelegramBotWebhook(
        req.body || {},
        req.header('x-telegram-bot-api-secret-token')
      );
      if (!ok) {
        res.status(403).json({ ok: false, error: 'Forbidden: Invalid Telegram Webhook Secret or Sender' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    // Direct Meta WhatsApp Cloud API Webhook (GET verification + POST incoming replies/buttons)
    if (path.endsWith('/meta-whatsapp-webhook')) {
      if (req.method === 'GET') {
        const result = await verifyMetaWhatsAppWebhookGet(
          (req.query || {}) as Record<string, unknown>
        );
        res.status(result.status).send(result.body);
        return;
      }
      await handleMetaWhatsAppWebhookPost((req.body || {}) as Record<string, unknown>);
      res.status(200).json({ ok: true });
      return;
    }

    // All Twilio-invoked webhook routes below require valid X-Twilio-Signature
    const querySuffix = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    const pathAndQuery = `${req.path}${querySuffix}`;
    const isTwilioSigned = hasValidTwilioSignature(
      req.header('x-twilio-signature'),
      pathAndQuery,
      req.originalUrl,
      req.get('host'),
      (req.body || {}) as Record<string, unknown>
    );

    // Incoming Twilio WhatsApp reply webhook (when Caregiver or Escalation Contact replies 1, 2, 3, or 9 on WhatsApp)
    if (path.endsWith('/whatsapp-webhook')) {
      if (!isTwilioSigned) {
        res.status(403).send('Forbidden: Invalid Twilio Signature');
        return;
      }
      const twimlXml = await handleIncomingWhatsAppWebhook(req.body || {});
      res.type('text/xml').send(twimlXml);
      return;
    }

    if (path.endsWith('/caregiver')) {
      if (!isTwilioSigned) {
        res.status(403).send('Forbidden: Invalid Twilio Signature');
        return;
      }
      const xml = await buildCaregiverPromptTwiml(taskId);
      res.type('text/xml').send(xml);
      return;
    }

    if (path.endsWith('/caregiver-gather')) {
      if (!isTwilioSigned) {
        res.status(403).send('Forbidden: Invalid Twilio Signature');
        return;
      }
      const digits = req.body?.Digits as string | undefined;
      const speech = req.body?.SpeechResult as string | undefined;
      const xml = await handleCaregiverGatherTwiml(taskId, digits, speech);
      res.type('text/xml').send(xml);
      return;
    }

    if (path.endsWith('/escalation')) {
      if (!isTwilioSigned) {
        res.status(403).send('Forbidden: Invalid Twilio Signature');
        return;
      }
      const xml = await buildEscalationPromptTwiml(taskId);
      res.type('text/xml').send(xml);
      return;
    }

    if (path.endsWith('/escalation-gather')) {
      if (!isTwilioSigned) {
        res.status(403).send('Forbidden: Invalid Twilio Signature');
        return;
      }
      const digits = req.body?.Digits as string | undefined;
      const xml = await handleEscalationGatherTwiml(taskId, digits);
      res.type('text/xml').send(xml);
      return;
    }

    if (path.endsWith('/status')) {
      if (!isTwilioSigned) {
        res.status(403).send('Forbidden: Invalid Twilio Signature');
        return;
      }
      const role = String(req.query.role || 'CAREGIVER');
      const channel = req.query.channel ? String(req.query.channel) : undefined;
      const callStatus = String(req.body?.CallStatus || '');
      await handleCallStatusWebhook(taskId, role, callStatus, channel);
      res.status(200).send({ ok: true });
      return;
    }

    res.status(404).send('Unknown TwiML endpoint');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * 3. Callable AI Function: Parse Natural Language Routine or Prescription with Gemini 2.5 Flash + Zod
 */
export const parseCareRoutine = onCall(async (request) => {
  const { naturalText, imageBase64, dashboardKey } = (request.data || {}) as {
    naturalText: string;
    imageBase64?: { data: string; mimeType: string };
    dashboardKey?: string;
  };
  if (!hasValidDashboardAuth(dashboardKey)) {
    throw new HttpsError('unauthenticated', 'Valid Family Passcode (dashboardKey) is required.');
  }
  const config = await getCareConfig();
  return parseScheduleWithGemini(naturalText, config, imageBase64);
});

/**
 * 4. Callable AI Function: Synthesize & Cache Urdu TTS Audio in Cloud Storage
 */
export const cacheTaskUrduAudio = onCall(async (request) => {
  const { templateId, scriptText, dashboardKey } = (request.data || {}) as {
    templateId: string;
    scriptText: string;
    dashboardKey?: string;
  };
  if (!hasValidDashboardAuth(dashboardKey)) {
    throw new HttpsError('unauthenticated', 'Valid Family Passcode (dashboardKey) is required.');
  }
  const config = await getCareConfig();
  const audioUrl = await synthesizeAndCacheTaskAudio(templateId, scriptText, config);
  return { audioUrl };
});
