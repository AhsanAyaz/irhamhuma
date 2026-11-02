import { computed, inject, Injectable, signal } from '@angular/core';
import {
  CallLogEntry,
  CareConfig,
  CareConfigSchema,
  DailyTask,
  DEFAULT_CARE_CONFIG,
  DEFAULT_SCHEDULE_TEMPLATES,
  EscalationReason,
  ScheduleTemplate,
} from '../models/care.models';
import { GeminiAiService } from './gemini-ai.service';

export interface ActiveCallSession {
  taskId: string;
  taskTitle: string;
  mode: 'CAREGIVER' | 'ESCALATION' | 'BRIDGED';
  recipientName: string;
  recipientPhone: string;
  attemptNumber: number;
  spokenScript: string;
  spokenScriptNative: string;
  cloudAudioUrl: string;
  escalationReason: EscalationReason;
  isSpeaking: boolean;
  lastFeedbackMessage: string | null;
}

const STORAGE_KEYS = {
  CONFIG: 'irhamhuma_care_config_v1',
  TEMPLATES: 'irhamhuma_schedule_templates_v1',
  DAILY_TASKS: 'irhamhuma_daily_tasks_v1',
  API_KEY: 'irhamhuma_dashboard_key_v1',
};

@Injectable({
  providedIn: 'root',
})
export class CareStateService {
  private readonly geminiService = inject(GeminiAiService);

  readonly dashboardApiKey = signal<string>(this.loadApiKey());
  readonly isAuthError = signal<boolean>(false);
  readonly isDemoMode = computed(
    () => !this.dashboardApiKey().trim() || this.isAuthError()
  );
  readonly config = signal<CareConfig>(this.loadConfig());
  readonly templates = signal<ScheduleTemplate[]>(this.loadTemplates());
  readonly dailyTasks = signal<DailyTask[]>(this.loadOrInitDailyTasks());
  readonly activeCall = signal<ActiveCallSession | null>(null);

  constructor() {
    // CRITICAL SAFETY: Only PULL from Firestore on startup; never push localStorage defaults on load!
    this.syncStateToCloud({ pullOnly: true });
    // Poll Firestore every 15 seconds so WhatsApp replies immediately update the Web Dashboard!
    if (typeof window !== 'undefined') {
      setInterval(() => {
        this.syncStateToCloud({ pullOnly: true });
      }, 15_000);
    }
  }

  setDashboardApiKey(key: string): void {
    const clean = key.trim();
    this.dashboardApiKey.set(clean);
    this.saveToStorage(STORAGE_KEYS.API_KEY, clean);
    this.isAuthError.set(false);
    this.syncStateToCloud({ pullOnly: true });
  }

  readonly sortedTasks = computed(() =>
    [...this.dailyTasks()].sort((a, b) => a.order - b.order)
  );

  readonly stats = computed(() => {
    const tasks = this.dailyTasks();
    const total = tasks.length;
    const completed = tasks.filter(
      (t) => t.status === 'COMPLETED' && !String(t.completedBy || '').startsWith('Auto-')
    ).length;
    const escalated = tasks.filter(
      (t) => t.status === 'ESCALATED' || t.status === 'BRIDGED'
    ).length;
    const snoozed = tasks.filter((t) => t.status === 'SNOOZED').length;
    const waiting = tasks.filter((t) => t.status === 'WAITING_FOR_PARENT').length;
    const compliancePercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      total,
      completed,
      escalated,
      snoozed,
      waiting,
      compliancePercent,
    };
  });

  readonly nextDueTask = computed(() => {
    const tasks = this.sortedTasks();
    return (
      tasks.find(
        (t) =>
          t.status === 'CALLING_CAREGIVER' ||
          t.status === 'ESCALATED' ||
          t.status === 'SNOOZED' ||
          t.status === 'RETRY_WAIT'
      ) ||
      tasks.find((t) => t.status === 'SCHEDULED') ||
      null
    );
  });

  readonly allCallLogs = computed(() => {
    const logs: Array<CallLogEntry & { taskTitle: string; taskId: string }> = [];
    for (const task of this.dailyTasks()) {
      for (const log of task.callLogs) {
        logs.push({ ...log, taskTitle: task.title, taskId: task.id });
      }
    }
    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });

  updateConfig(partial: Partial<CareConfig>): void {
    const merged = CareConfigSchema.parse({
      ...this.config(),
      ...partial,
    });
    this.config.set(merged);
    this.saveToStorage(STORAGE_KEYS.CONFIG, merged);
    // Sync ONLY config so saving Settings never overwrites Firestore task statuses!
    this.syncStateToCloud({ configOnly: true });
  }

  replaceScheduleTemplates(newTemplates: ScheduleTemplate[]): void {
    const ordered = newTemplates.map((item, idx) => ({
      ...item,
      order: idx + 1,
    }));
    this.templates.set(ordered);
    this.saveToStorage(STORAGE_KEYS.TEMPLATES, ordered);
    this.regenerateDailyTasksFromTemplates(ordered);
  }

  addOrUpdateTemplate(template: ScheduleTemplate): void {
    this.templates.update((current) => {
      const idx = current.findIndex((t) => t.id === template.id);
      const next =
        idx >= 0
          ? current.map((t, i) => (i === idx ? template : t))
          : [...current, { ...template, order: current.length + 1 }];
      this.saveToStorage(STORAGE_KEYS.TEMPLATES, next);
      return next;
    });
    this.regenerateDailyTasksFromTemplates(this.templates());
  }

  deleteTemplate(templateId: string): void {
    this.templates.update((current) => {
      const filtered = current
        .filter((t) => t.id !== templateId)
        .map((t, idx) => ({ ...t, order: idx + 1 }));
      this.saveToStorage(STORAGE_KEYS.TEMPLATES, filtered);
      return filtered;
    });
    this.regenerateDailyTasksFromTemplates(this.templates());
  }

  resetTodayProgress(): void {
    this.regenerateDailyTasksFromTemplates(this.templates());
  }

  /**
   * Updates a task's Urdu script (Nastaliq & Roman) directly from the Slide-Over Drawer
   * and immediately regenerates its Google Cloud TTS audio stream URL.
   */
  updateTaskUrduScript(
    taskId: string,
    newUrduNative: string,
    newUrduRoman: string
  ): void {
    const targetTask = this.dailyTasks().find((t) => t.id === taskId);
    if (!targetTask) return;

    this.templates.update((tpls) => {
      const next = tpls.map((tpl) =>
        tpl.id === targetTask.templateId
          ? {
              ...tpl,
              urduScriptNative: newUrduNative,
              urduScript: newUrduRoman,
            }
          : tpl
      );
      this.saveToStorage(STORAGE_KEYS.TEMPLATES, next);
      return next;
    });

    this.dailyTasks.update((tasks) => {
      const next = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              urduScriptNative: newUrduNative,
              urduScript: newUrduRoman,
            }
          : t
      );
      this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, next);
      return next;
    });

    const newStreamUrl = this.getCloudUrduAudioStreamUrl(taskId, newUrduNative);
    this.activeCall.update((curr) =>
      curr && curr.taskId === taskId
        ? {
            ...curr,
            spokenScriptNative: newUrduNative,
            spokenScript: newUrduRoman,
            cloudAudioUrl: `${newStreamUrl}&_t=${Date.now()}`,
            lastFeedbackMessage: '✓ Urdu script saved and audio regenerated via Google Cloud TTS!',
          }
        : curr
    );

    this.syncStateToCloud();
  }

  /**
   * Opens the Slide-Over Right Drawer to preview & auto-play the Native Urdu Cloud TTS script
   * without changing task status until the user chooses an action.
   */
  openScriptDrawer(taskId: string): void {
    this.geminiService.stopSpeaking();
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) return;
    const cfg = this.config();

    this.activeCall.set({
      taskId: task.id,
      taskTitle: task.title,
      mode: 'CAREGIVER',
      recipientName: cfg.caregiverTitle,
      recipientPhone: cfg.caregiverPhone,
      attemptNumber: Math.max(1, task.attemptCount),
      spokenScript: task.urduScript,
      spokenScriptNative: task.urduScriptNative,
      cloudAudioUrl: this.getCloudUrduAudioStreamUrl(task.id, task.urduScriptNative),
      escalationReason: 'NONE',
      isSpeaking: true,
      lastFeedbackMessage: null,
    });
  }

  /**
   * Step 1 of State Machine: Initiates a reminder call to the Primary Caregiver
   */
  initiateCaregiverCall(taskId: string, isRetry = false): void {
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) return;

    const cfg = this.config();
    const attemptNumber = isRetry ? task.attemptCount + 1 : 1;

    const logEntry: CallLogEntry = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      targetRole: 'CAREGIVER',
      targetName: cfg.caregiverTitle,
      targetPhone: cfg.caregiverPhone,
      attemptNumber,
      outcome: 'INITIATED',
      notes: `Outbound call placed to ${cfg.caregiverTitle} (Attempt ${attemptNumber}) for "${task.title}".`,
    };

    this.dailyTasks.update((tasks) => {
      const updated = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: 'CALLING_CAREGIVER' as const,
              attemptCount: attemptNumber,
              callLogs: [logEntry, ...t.callLogs],
            }
          : t
      );
      this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, updated);
      return updated;
    });

    const session: ActiveCallSession = {
      taskId: task.id,
      taskTitle: task.title,
      mode: 'CAREGIVER',
      recipientName: cfg.caregiverTitle,
      recipientPhone: cfg.caregiverPhone,
      attemptNumber,
      spokenScript: task.urduScript,
      spokenScriptNative: task.urduScriptNative,
      cloudAudioUrl: this.getCloudUrduAudioStreamUrl(task.id, task.urduScriptNative),
      escalationReason: 'NONE',
      isSpeaking: true,
      lastFeedbackMessage: null,
    };

    this.activeCall.set(session);
  }

  /**
   * Handles Keypad / Voice input from Primary Caregiver:
   * - Digit '1': Confirmed completed -> Unlocks any dependent AFTER_TASK items!
   * - Digit '2': Snooze 15 mins (or escalate if maxSnoozes reached)
   * - Digit '3': Patient is refusing -> Immediately escalate to Escalation Contact!
   */
  handleCaregiverDigit(taskId: string, digit: '1' | '2' | '3'): void {
    this.geminiService.stopSpeaking();
    const cfg = this.config();
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) return;

    if (digit === '1') {
      this.markTaskCompleted(taskId, cfg.caregiverTitle, '1');
      const doneUrdu = `جزاک اللہ ${cfg.caregiverTitle}! ریکارڈ محفوظ ہو گیا ہے۔ اللہ ${cfg.patientTitle} کو صحت کاملہ عطا فرمائے۔`;
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              isSpeaking: false,
              cloudAudioUrl: this.getCloudUrduAudioStreamUrl(taskId, doneUrdu),
              lastFeedbackMessage: `JazakAllah ${cfg.caregiverTitle}! Marked "${task.title}" as COMPLETED and scheduled dependent tasks.`,
            }
          : null
      );
      setTimeout(() => {
        if (this.activeCall()?.taskId === taskId) {
          this.activeCall.set(null);
        }
      }, 3200);
      return;
    }

    if (digit === '2') {
      const nextSnoozeCount = task.snoozeCount + 1;
      if (nextSnoozeCount > cfg.maxSnoozes) {
        this.escalateToSon(taskId, 'TOO_MANY_SNOOZES');
        return;
      }

      const snoozeUntil = this.addMinutesToNowDisplay(cfg.snoozeDurationMinutes);
      const logEntry: CallLogEntry = {
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        targetRole: 'CAREGIVER',
        targetName: cfg.caregiverTitle,
        targetPhone: cfg.caregiverPhone,
        attemptNumber: task.attemptCount,
        outcome: 'SNOOZED',
        digitPressed: '2',
        notes: `${cfg.caregiverTitle} pressed 2 to snooze "${task.title}" for ${cfg.snoozeDurationMinutes}m (Snooze ${nextSnoozeCount}/${cfg.maxSnoozes}, next call at ${snoozeUntil}).`,
      };

      this.dailyTasks.update((tasks) => {
        const updated = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'SNOOZED' as const,
                snoozeCount: nextSnoozeCount,
                scheduledTimeDisplay: `${snoozeUntil} (Snoozed #${nextSnoozeCount})`,
                callLogs: [logEntry, ...t.callLogs],
              }
            : t
        );
        this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, updated);
        return updated;
      });

      const snoozeUrdu = `ٹھیک ہے ${cfg.caregiverTitle}، ${cfg.snoozeDurationMinutes} منٹ بعد دوبارہ یاد دلائیں گے۔`;
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              isSpeaking: false,
              cloudAudioUrl: this.getCloudUrduAudioStreamUrl(taskId, snoozeUrdu),
              lastFeedbackMessage: `Snoozed for ${cfg.snoozeDurationMinutes} minutes. Will call ${cfg.caregiverTitle} again at ${snoozeUntil}.`,
            }
          : null
      );
      setTimeout(() => {
        if (this.activeCall()?.taskId === taskId) {
          this.activeCall.set(null);
        }
      }, 3000);
      return;
    }

    if (digit === '3') {
      // Patient is refusing! Immediately escalate to Escalation Contact
      this.escalateToSon(taskId, 'PATIENT_REFUSING', '3');
    }
  }

  /**
   * Handles when Caregiver does not pick up or call is busy.
   * - Attempt 1: Schedules Retry after retryDelayMinutes (e.g. 3 mins).
   * - Attempt 2+: Automatically escalates and calls Escalation Contact!
   */
  handleCaregiverNoAnswer(taskId: string): void {
    this.geminiService.stopSpeaking();
    const cfg = this.config();
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) return;

    if (task.attemptCount < 2) {
      const retryTime = this.addMinutesToNowDisplay(cfg.retryDelayMinutes);
      const logEntry: CallLogEntry = {
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        targetRole: 'CAREGIVER',
        targetName: cfg.caregiverTitle,
        targetPhone: cfg.caregiverPhone,
        attemptNumber: task.attemptCount,
        outcome: 'NO_ANSWER',
        notes: `${cfg.caregiverTitle} did not answer Attempt #1. Scheduled automatic retry #2 in ${cfg.retryDelayMinutes} mins (${retryTime}).`,
      };

      this.dailyTasks.update((tasks) => {
        const updated = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'RETRY_WAIT' as const,
                scheduledTimeDisplay: `${retryTime} (Retry #2)`,
                callLogs: [logEntry, ...t.callLogs],
              }
            : t
        );
        this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, updated);
        return updated;
      });

      // Automatically transition the simulator to Attempt #2 or let the user see the retry
      this.initiateCaregiverCall(taskId, true);
    } else {
      // Attempt 2 also unanswered -> Escalate to Escalation Contact!
      this.escalateToSon(taskId, 'NO_ANSWER');
    }
  }

  /**
   * Escalates a task to the Escalation contact
   */
  escalateToSon(
    taskId: string,
    reason: EscalationReason,
    digitPressed?: '3'
  ): void {
    this.geminiService.stopSpeaking();
    const cfg = this.config();
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) return;

    const reasonText =
      reason === 'PATIENT_REFUSING'
        ? `${cfg.caregiverTitle} pressed 3: ${cfg.patientTitle} is refusing "${task.title}"!`
        : reason === 'NO_ANSWER'
          ? `${cfg.caregiverTitle} did not answer after ${task.attemptCount} attempts for "${task.title}".`
          : reason === 'TOO_MANY_SNOOZES'
            ? `"${task.title}" was snoozed ${task.snoozeCount} times without completion.`
            : `Manual escalation triggered for "${task.title}".`;

    const logEntry: CallLogEntry = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      targetRole: 'ESCALATION',
      targetName: cfg.escalationName,
      targetPhone: cfg.escalationPhone,
      attemptNumber: 1,
      outcome: reason === 'PATIENT_REFUSING' ? 'REFUSED_ESCALATED' : 'NO_ANSWER',
      digitPressed,
      notes: `${reasonText} Placing escalation call to ${cfg.escalationName} (${cfg.escalationPhone}).`,
    };

    const dynamicEscalationScript =
      reason === 'PATIENT_REFUSING'
        ? `Assalam-o-Alaikum ${cfg.escalationName}! Urgent alert: ${cfg.caregiverTitle} pressed 3 because ${cfg.patientTitle} is refusing "${task.title}". Press 1 if handled, Press 2 to re-call ${cfg.caregiverTitle} in ${cfg.snoozeDurationMinutes} minutes, or Press 9 to immediately bridge this call to ${cfg.caregiverTitle} and ${cfg.patientTitle}.`
        : `Assalam-o-Alaikum ${cfg.escalationName}! ${cfg.caregiverTitle} did not pick up the phone after 2 attempts for ${cfg.patientTitle}'s "${task.title}". Press 1 if you have confirmed it is done, Press 2 to call ${cfg.caregiverTitle} again in ${cfg.snoozeDurationMinutes} minutes, or Press 9 to live-bridge your call to home.`;

    this.dailyTasks.update((tasks) => {
      const updated = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: 'ESCALATED' as const,
              escalationReason: reason,
              callLogs: [logEntry, ...t.callLogs],
            }
          : t
      );
      this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, updated);
      return updated;
    });

    const escalationUrduNative = `السلام علیکم ${cfg.escalationName}! ایمرجنسی اطلاع: ${cfg.patientTitle} کے "${task.title}" کے لیے آپ کی مدد درکار ہے۔ مکمل کرنے کے لیے ایک دبائیں، دوبارہ کال کے لیے دو دبائیں، یا امی اور ابو سے براہ راست بات کرنے کے لیے نو دبائیں۔`;

    this.activeCall.set({
      taskId: task.id,
      taskTitle: task.title,
      mode: 'ESCALATION',
      recipientName: cfg.escalationName,
      recipientPhone: cfg.escalationPhone,
      attemptNumber: 1,
      spokenScript: dynamicEscalationScript,
      spokenScriptNative: escalationUrduNative,
      cloudAudioUrl: this.getCloudUrduAudioStreamUrl(task.id, escalationUrduNative),
      escalationReason: reason,
      isSpeaking: true,
      lastFeedbackMessage: reasonText,
    });
  }

  /**
   * Handles Keypad input from Escalation Contact:
   * - Digit '1': Mark Completed (unlocks dependent tasks)
   * - Digit '2': Snooze & schedule re-call to Caregiver in 15m
   * - Digit '9': Live Call Bridge (<Dial> connects Escalation Contact directly to Caregiver/Patient)
   */
  handleEscalationDigit(taskId: string, digit: '1' | '2' | '9'): void {
    this.geminiService.stopSpeaking();
    const cfg = this.config();
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) return;

    if (digit === '1') {
      this.markTaskCompleted(taskId, cfg.escalationName, '1');
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              isSpeaking: false,
              lastFeedbackMessage: `Marked "${task.title}" as COMPLETED by ${cfg.escalationName}. Dependent tasks unlocked!`,
            }
          : null
      );
      setTimeout(() => {
        if (this.activeCall()?.taskId === taskId) {
          this.activeCall.set(null);
        }
      }, 2000);
      return;
    }

    if (digit === '2') {
      const snoozeUntil = this.addMinutesToNowDisplay(cfg.snoozeDurationMinutes);
      const logEntry: CallLogEntry = {
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        targetRole: 'ESCALATION',
        targetName: cfg.escalationName,
        targetPhone: cfg.escalationPhone,
        attemptNumber: 1,
        outcome: 'SNOOZED',
        digitPressed: '2',
        notes: `${cfg.escalationName} pressed 2: Re-scheduled call to ${cfg.caregiverTitle} in ${cfg.snoozeDurationMinutes}m (${snoozeUntil}).`,
      };

      this.dailyTasks.update((tasks) => {
        const updated = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'SNOOZED' as const,
                snoozeCount: 0,
                attemptCount: 0,
                scheduledTimeDisplay: `${snoozeUntil} (Re-scheduled by ${cfg.escalationName})`,
                callLogs: [logEntry, ...t.callLogs],
              }
            : t
        );
        this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, updated);
        return updated;
      });

      this.activeCall.set(null);
      return;
    }

    if (digit === '9') {
      // Press 9 Live Call Bridging via Twilio <Dial>!
      const logEntry: CallLogEntry = {
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        targetRole: 'BRIDGE',
        targetName: `${cfg.escalationName} ↔ ${cfg.caregiverTitle}/${cfg.patientTitle}`,
        targetPhone: cfg.caregiverPhone,
        attemptNumber: 1,
        outcome: 'BRIDGED_CALL',
        digitPressed: '9',
        notes: `${cfg.escalationName} pressed 9: Live TwiML <Dial> bridged call directly to ${cfg.caregiverTitle} & ${cfg.patientTitle} (${cfg.caregiverPhone}).`,
      };

      this.dailyTasks.update((tasks) => {
        const updated = tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'BRIDGED' as const,
                callLogs: [logEntry, ...t.callLogs],
              }
            : t
        );
        this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, updated);
        return updated;
      });

      const bridgeUrdu = `آپ کی کال ابھی ${cfg.caregiverTitle} اور ${cfg.patientTitle} کے نمبر سے ملائی جا رہی ہے۔`;
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              mode: 'BRIDGED',
              isSpeaking: false,
              cloudAudioUrl: this.getCloudUrduAudioStreamUrl(taskId, bridgeUrdu),
              lastFeedbackMessage: `LIVE CALL BRIDGED: ${cfg.escalationName} is now speaking directly with ${cfg.caregiverTitle} & ${cfg.patientTitle} via Twilio <Dial>${cfg.caregiverPhone}</Dial>.`,
            }
          : null
      );
    }
  }

  /**
   * Marks a task COMPLETED and automatically unlocks & schedules any dependent AFTER_TASK items!
   */
  markTaskCompleted(
    taskId: string,
    completedBy: string,
    digitPressed?: '1'
  ): void {
    const nowIso = new Date().toISOString();
    const nowTimeDisplay = this.formatTimeHHMM(new Date());
    const targetTask = this.dailyTasks().find((t) => t.id === taskId);
    if (!targetTask) return;

    const completionLog: CallLogEntry = {
      id: `log_${Date.now()}`,
      timestamp: nowIso,
      targetRole: completedBy === this.config().escalationName ? 'ESCALATION' : 'CAREGIVER',
      targetName: completedBy,
      targetPhone:
        completedBy === this.config().escalationName
          ? this.config().escalationPhone
          : this.config().caregiverPhone,
      attemptNumber: Math.max(1, targetTask.attemptCount),
      outcome: 'CONFIRMED_DONE',
      digitPressed,
      notes: `Confirmed COMPLETED by ${completedBy} at ${nowTimeDisplay}.`,
    };

    this.dailyTasks.update((tasks) => {
      const updated = tasks.map((t) => {
        if (t.id === taskId) {
          return {
            ...t,
            status: 'COMPLETED' as const,
            completedAt: nowIso,
            completedBy,
            callLogs: [completionLog, ...t.callLogs],
          };
        }

        // Check if this task depends on the completed parent task!
        if (
          t.triggerType === 'AFTER_TASK' &&
          t.parentTemplateId === targetTask.templateId &&
          t.status === 'WAITING_FOR_PARENT'
        ) {
          const offsetMins = t.offsetMinutes ?? 15;
          const unlockedTime = this.addMinutesToNowDisplay(offsetMins);
          const unlockLog: CallLogEntry = {
            id: `log_unlock_${Date.now()}_${t.id}`,
            timestamp: nowIso,
            targetRole: 'CAREGIVER',
            targetName: this.config().caregiverTitle,
            targetPhone: this.config().caregiverPhone,
            attemptNumber: 0,
            outcome: 'INITIATED',
            notes: `Automatically unlocked and scheduled for ${unlockedTime} (+${offsetMins}m after "${targetTask.title}" completed at ${nowTimeDisplay}).`,
          };

          return {
            ...t,
            status: 'SCHEDULED' as const,
            scheduledAt: new Date(Date.now() + offsetMins * 60_000).toISOString(),
            scheduledTimeDisplay: `${unlockedTime} (+${offsetMins}m after ${targetTask.title})`,
            callLogs: [unlockLog, ...t.callLogs],
          };
        }

        return t;
      });

      this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, updated);
      return updated;
    });
    this.syncStateToCloud({ forceOverwriteTasks: true });
  }

  closeCallModal(): void {
    this.geminiService.stopSpeaking();
    this.activeCall.set(null);
  }

  private getRouterBaseUrl(): string {
    const custom = this.config().backendWebhookUrl?.trim();
    if (custom) {
      return custom.replace(/\/$/, '').replace(/\/trigger-live-call$/, '');
    }
    return '/twiml';
  }

  getCloudUrduAudioStreamUrl(taskId: string, urduNativeText: string): string {
    const base = `${this.getRouterBaseUrl()}/audio.mp3`;
    const voice = this.config().voiceName || 'ur-PK-Standard-A';
    return `${base}?taskId=${encodeURIComponent(taskId)}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(urduNativeText)}`;
  }

  async triggerWhatsAppAlert(
    taskId: string
  ): Promise<{ ok: boolean; details: string }> {
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) {
      return { ok: false, details: 'Task not found.' };
    }
    const endpoint = `${this.getRouterBaseUrl()}/trigger-whatsapp`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-irhamhuma-key': this.dashboardApiKey(),
        },
        body: JSON.stringify({
          task,
        }),
      });
      if (response.status === 401) {
        this.isAuthError.set(true);
      }
      const data = (await response.json()) as {
        ok?: boolean;
        details?: string;
        error?: string;
      };
      const details = data.details || data.error || 'WhatsApp response received';
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              lastFeedbackMessage: data.ok
                ? `💬 WhatsApp + Native Urdu Voice Note Dispatched: ${details}`
                : `⚠️ WhatsApp Error: ${details}`,
            }
          : null
      );
      return { ok: Boolean(data.ok), details };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'WhatsApp trigger failed';
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              lastFeedbackMessage: `⚠️ WhatsApp Error: ${msg}`,
            }
          : null
      );
      return { ok: false, details: msg };
    }
  }

  async triggerTelegramAlert(
    taskId: string
  ): Promise<{ ok: boolean; details: string }> {
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) {
      return { ok: false, details: 'Task not found.' };
    }
    const endpoint = `${this.getRouterBaseUrl()}/trigger-telegram`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-irhamhuma-key': this.dashboardApiKey(),
        },
        body: JSON.stringify({
          task,
        }),
      });
      if (response.status === 401) {
        this.isAuthError.set(true);
      }
      const data = (await response.json()) as {
        ok?: boolean;
        details?: string;
        error?: string;
      };
      const details = data.details || data.error || 'Telegram response received';
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              lastFeedbackMessage: data.ok
                ? `✈️ $0.00 Telegram Alert Sent: ${details}`
                : `⚠️ Telegram Notice: ${details}`,
            }
          : null
      );
      return { ok: Boolean(data.ok), details };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Telegram trigger failed';
      return { ok: false, details: msg };
    }
  }

  async triggerRealTwilioCall(
    taskId: string,
    targetRole: 'CAREGIVER' | 'ESCALATION'
  ): Promise<{ ok: boolean; message: string }> {
    const task = this.dailyTasks().find((t) => t.id === taskId);
    if (!task) {
      return { ok: false, message: 'Task not found.' };
    }
    const endpoint = `${this.getRouterBaseUrl()}/trigger-live-call`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-irhamhuma-key': this.dashboardApiKey(),
        },
        body: JSON.stringify({
          task,
          targetRole,
        }),
      });
      if (response.status === 401) {
        this.isAuthError.set(true);
      }
      const data = (await response.json()) as {
        ok?: boolean;
        callSid?: string;
        toPhone?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              lastFeedbackMessage: `📲 Real Twilio PSTN Call Dispatched! Calling ${data.toPhone} (Call SID: ${data.callSid}).`,
            }
          : null
      );
      return {
        ok: true,
        message: `Calling ${data.toPhone} (SID: ${data.callSid})`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Twilio call request failed';
      this.activeCall.update((curr) =>
        curr
          ? {
              ...curr,
              lastFeedbackMessage: `⚠️ Live Twilio Call Error: ${msg}`,
            }
          : null
      );
      return { ok: false, message: msg };
    }
  }

  speakCurrentSessionPrompt(): void {
    const session = this.activeCall();
    if (!session) return;

    this.activeCall.update((curr) => (curr ? { ...curr, isSpeaking: true } : null));
    this.geminiService.speakInBrowser(
      session.spokenScript,
      session.mode === 'CAREGIVER' ? this.config().language : 'en-US',
      () => {
        this.activeCall.update((curr) => (curr ? { ...curr, isSpeaking: false } : null));
      }
    );
  }

  private regenerateDailyTasksFromTemplates(templates: ScheduleTemplate[]): void {
    const todayKey = new Date().toISOString().slice(0, 10);
    const tasks: DailyTask[] = templates
      .filter((tpl) => tpl.active)
      .sort((a, b) => a.order - b.order)
      .map((tpl) => {
        const isFixed = tpl.triggerType === 'FIXED_TIME';
        const parentTpl = templates.find((p) => p.id === tpl.parentTemplateId);
        return {
          id: `${todayKey}_${tpl.id}`,
          templateId: tpl.id,
          dateKey: todayKey,
          title: tpl.title,
          category: tpl.category,
          triggerType: tpl.triggerType,
          fixedTime: tpl.fixedTime,
          parentTemplateId: tpl.parentTemplateId,
          offsetMinutes: tpl.offsetMinutes,
          instructions: tpl.instructions,
          urduScript: tpl.urduScript,
          urduScriptNative: tpl.urduScriptNative,
          escalationScript: tpl.escalationScript,
          order: tpl.order,
          status: isFixed ? 'SCHEDULED' : 'WAITING_FOR_PARENT',
          scheduledAt: isFixed ? tpl.fixedTime : null,
          scheduledTimeDisplay: isFixed
            ? `${tpl.fixedTime} PKT`
            : `+${tpl.offsetMinutes ?? 15}m after ${parentTpl?.title ?? tpl.parentTemplateId}`,
          attemptCount: 0,
          snoozeCount: 0,
          escalationReason: 'NONE',
          completedAt: null,
          completedBy: null,
          callLogs: [],
        };
      });

    this.dailyTasks.set(tasks);
    this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, tasks);
    this.syncStateToCloud();
  }

  syncStateToCloud(options?: {
    configOnly?: boolean;
    forceOverwriteTasks?: boolean;
    pullOnly?: boolean;
  }): void {
    if (typeof window === 'undefined') return;
    const key = this.dashboardApiKey().trim();
    if (!key || this.isAuthError()) return;
    const endpoint = `${this.getRouterBaseUrl()}/sync-state`;
    const payload = options?.pullOnly
      ? { pullOnly: true }
      : options?.configOnly
        ? { config: this.config() }
        : {
            config: this.config(),
            templates: this.templates(),
            dailyTasks: this.dailyTasks(),
            forceOverwriteTasks: Boolean(options?.forceOverwriteTasks),
          };

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-irhamhuma-key': this.dashboardApiKey(),
      },
      body: JSON.stringify(payload),
    })
      .then((r) => {
        if (r.status === 401) {
          this.isAuthError.set(true);
        }
        return r.json();
      })
      .then(
        (data: {
          ok?: boolean;
          config?: Partial<CareConfig>;
          templates?: ScheduleTemplate[];
          dailyTasks?: Array<Partial<DailyTask>>;
        }) => {
          if (!data?.ok) return;
          this.isAuthError.set(false);

          if (options?.pullOnly && data.config) {
            try {
              const mergedCfg = CareConfigSchema.parse({
                ...this.config(),
                ...data.config,
                geminiApiKey: this.config().geminiApiKey || data.config.geminiApiKey || '',
              });
              this.config.set(mergedCfg);
              this.saveToStorage(STORAGE_KEYS.CONFIG, mergedCfg);
            } catch {
              // Keep local config if parse fails
            }
          }

          if (options?.pullOnly && Array.isArray(data.templates) && data.templates.length > 0) {
            const migratedTpls = data.templates.map((tpl, idx) => ({
              ...tpl,
              order: tpl.order ?? idx + 1,
              active: tpl.active !== false,
              urduScript: this.migrateUrduPhrasing(tpl.urduScript || ''),
              urduScriptNative: this.migrateUrduPhrasing(tpl.urduScriptNative || ''),
            }));
            this.templates.set(migratedTpls);
            this.saveToStorage(STORAGE_KEYS.TEMPLATES, migratedTpls);
          }

          if (
            Array.isArray(data.dailyTasks) &&
            data.dailyTasks.length > 0 &&
            !options?.forceOverwriteTasks
          ) {
            const existingLocalMap = new Map<string, DailyTask>();
            for (const lt of this.dailyTasks()) {
              existingLocalMap.set(lt.templateId, lt);
            }

            const hydratedTasks: DailyTask[] = data.dailyTasks
              .filter((ct) => Boolean(ct.templateId))
              .map((ct, idx) => {
                const tplId = String(ct.templateId);
                const local = existingLocalMap.get(tplId);
                const tplFallback = this.templates().find((t) => t.id === tplId);
                return {
                  id: String(ct.id || local?.id || tplId),
                  templateId: tplId,
                  dateKey: String(ct.dateKey || local?.dateKey || new Date().toISOString().slice(0, 10)),
                  title: String(ct.title || local?.title || tplFallback?.title || tplId),
                  category: ct.category || local?.category || tplFallback?.category || 'MEDICATION',
                  triggerType: ct.triggerType || local?.triggerType || tplFallback?.triggerType || 'FIXED_TIME',
                  fixedTime: ct.fixedTime ?? local?.fixedTime ?? tplFallback?.fixedTime ?? null,
                  parentTemplateId: ct.parentTemplateId ?? local?.parentTemplateId ?? tplFallback?.parentTemplateId ?? null,
                  offsetMinutes: ct.offsetMinutes ?? local?.offsetMinutes ?? tplFallback?.offsetMinutes ?? null,
                  instructions: String(ct.instructions || local?.instructions || tplFallback?.instructions || ''),
                  urduScript: this.migrateUrduPhrasing(
                    String(ct.urduScript || local?.urduScript || tplFallback?.urduScript || '')
                  ),
                  urduScriptNative: this.migrateUrduPhrasing(
                    String(ct.urduScriptNative || local?.urduScriptNative || tplFallback?.urduScriptNative || '')
                  ),
                  escalationScript: String(
                    ct.escalationScript || local?.escalationScript || tplFallback?.escalationScript || ''
                  ),
                  order: Number(ct.order ?? local?.order ?? tplFallback?.order ?? idx + 1),
                  status: ct.status || local?.status || 'SCHEDULED',
                  scheduledAt: ct.scheduledAt ?? local?.scheduledAt ?? null,
                  scheduledTimeDisplay: String(
                    ct.scheduledTimeDisplay || local?.scheduledTimeDisplay || ''
                  ),
                  attemptCount: Number(ct.attemptCount ?? local?.attemptCount ?? 0),
                  snoozeCount: Number(ct.snoozeCount ?? local?.snoozeCount ?? 0),
                  escalationReason: ct.escalationReason || local?.escalationReason || 'NONE',
                  completedAt: ct.completedAt ?? local?.completedAt ?? null,
                  completedBy: ct.completedBy ?? local?.completedBy ?? null,
                  callLogs: Array.isArray(ct.callLogs) && ct.callLogs.length > 0 ? ct.callLogs : local?.callLogs || [],
                };
              })
              .sort((a, b) => a.order - b.order);

            this.dailyTasks.set(hydratedTasks);
            this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, hydratedTasks);
          }
        }
      )
      .catch(() => {});
  }

  private migrateUrduPhrasing(text: string): string {
    return text
      .replace(/تو 1 دبائیں/g, 'تو جواب میں 1 لکھ کر بھیجیں')
      .replace(/1 دبائیں/g, '1 لکھ کر بھیجیں')
      .replace(/2 دبائیں/g, '2 لکھ کر بھیجیں')
      .replace(/3 دبائیں/g, '3 لکھ کر بھیجیں')
      .replace(/3 دبا کر/g, '3 لکھ کر')
      .replace(/to 1 dabayein/gi, 'to jawab mein 1 likh kar bhejein')
      .replace(/1 dabayein/gi, '1 likh kar bhejein')
      .replace(/2 dabayein/gi, '2 likh kar bhejein')
      .replace(/3 dabayein/gi, '3 likh kar bhejein')
      .replace(/3 daba kar/gi, '3 likh kar bhejein taake');
  }

  private addMinutesToNowDisplay(minutes: number): string {
    const target = new Date(Date.now() + minutes * 60_000);
    return this.formatTimeHHMM(target);
  }

  private formatTimeHHMM(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  }

  private loadApiKey(): string {
    if (typeof window === 'undefined') return '';
    try {
      const params = new URLSearchParams(window.location.search);
      const urlKey = params.get('key');
      if (urlKey && urlKey.trim()) {
        window.localStorage.setItem(STORAGE_KEYS.API_KEY, JSON.stringify(urlKey.trim()));
        return urlKey.trim();
      }
      const raw = window.localStorage.getItem(STORAGE_KEYS.API_KEY);
      if (!raw) return '';
      return String(JSON.parse(raw) || '');
    } catch {
      return '';
    }
  }

  private loadConfig(): CareConfig {
    if (typeof window === 'undefined') return DEFAULT_CARE_CONFIG;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (!raw) return DEFAULT_CARE_CONFIG;
      return CareConfigSchema.parse(JSON.parse(raw));
    } catch {
      return DEFAULT_CARE_CONFIG;
    }
  }

  private loadTemplates(): ScheduleTemplate[] {
    if (typeof window === 'undefined') return DEFAULT_SCHEDULE_TEMPLATES;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.TEMPLATES);
      if (!raw) return DEFAULT_SCHEDULE_TEMPLATES;
      const parsed = JSON.parse(raw) as ScheduleTemplate[];
      const migrated = parsed.map((tpl) => ({
        ...tpl,
        urduScript: this.migrateUrduPhrasing(tpl.urduScript || ''),
        urduScriptNative: this.migrateUrduPhrasing(tpl.urduScriptNative || ''),
      }));
      this.saveToStorage(STORAGE_KEYS.TEMPLATES, migrated);
      return migrated;
    } catch {
      return DEFAULT_SCHEDULE_TEMPLATES;
    }
  }

  private loadOrInitDailyTasks(): DailyTask[] {
    const todayKey = new Date().toISOString().slice(0, 10);
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEYS.DAILY_TASKS);
        if (raw) {
          const parsed = JSON.parse(raw) as DailyTask[];
          if (parsed.length > 0 && parsed[0].dateKey === todayKey) {
            const migrated = parsed.map((t) => ({
              ...t,
              urduScript: this.migrateUrduPhrasing(t.urduScript || ''),
              urduScriptNative: this.migrateUrduPhrasing(t.urduScriptNative || ''),
            }));
            this.saveToStorage(STORAGE_KEYS.DAILY_TASKS, migrated);
            return migrated;
          }
        }
      } catch {
        // Fallback to fresh generation
      }
    }
    const templates = this.loadTemplates();
    const tasks: DailyTask[] = templates
      .filter((tpl) => tpl.active)
      .sort((a, b) => a.order - b.order)
      .map((tpl) => {
        const isFixed = tpl.triggerType === 'FIXED_TIME';
        const parentTpl = templates.find((p) => p.id === tpl.parentTemplateId);
        return {
          id: `${todayKey}_${tpl.id}`,
          templateId: tpl.id,
          dateKey: todayKey,
          title: tpl.title,
          category: tpl.category,
          triggerType: tpl.triggerType,
          fixedTime: tpl.fixedTime,
          parentTemplateId: tpl.parentTemplateId,
          offsetMinutes: tpl.offsetMinutes,
          instructions: tpl.instructions,
          urduScript: tpl.urduScript,
          urduScriptNative: tpl.urduScriptNative,
          escalationScript: tpl.escalationScript,
          order: tpl.order,
          status: isFixed ? 'SCHEDULED' : 'WAITING_FOR_PARENT',
          scheduledAt: isFixed ? tpl.fixedTime : null,
          scheduledTimeDisplay: isFixed
            ? `${tpl.fixedTime} PKT`
            : `+${tpl.offsetMinutes ?? 15}m after ${parentTpl?.title ?? tpl.parentTemplateId}`,
          attemptCount: 0,
          snoozeCount: 0,
          escalationReason: 'NONE',
          completedAt: null,
          completedBy: null,
          callLogs: [],
        };
      });
    return tasks;
  }

  private saveToStorage(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage quota errors
    }
  }
}
