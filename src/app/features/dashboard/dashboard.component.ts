import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CareStateService } from '../../core/services/care-state.service';
import { DailyTask, TaskCategory, TaskStatus } from '../../core/models/care.models';

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Top Hero Stats & Next Action Banner -->
      <section
        class="relative overflow-hidden rounded-3xl border border-emerald-900/20 bg-gradient-to-br from-slate-900 via-emerald-950 to-teal-950 p-5 text-white shadow-xl sm:p-7"
      >
        <div class="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div class="space-y-1.5">
            <div class="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300">
              <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
              Active Post-Discharge Recovery Guard for {{ careState.config().patientTitle }}
            </div>
            <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
              {{ careState.config().patientTitle }}'s Daily Medication &amp; Nutrition Schedule
            </h1>
            <p class="max-w-2xl text-xs sm:text-sm text-slate-300">
              Native Pakistani Urdu (<strong>{{ careState.config().voiceName }}</strong>) WhatsApp + Voice calls to
              <strong class="text-white">{{ careState.config().caregiverTitle }}</strong>
              ({{ careState.config().caregiverPhone }}) with meal-chained offsets and Press-9 live call bridging to
              <strong class="text-white">{{ careState.config().escalationName }}</strong>.
            </p>
          </div>

          <!-- Compliance Progress & Primary Call Trigger -->
          <div class="flex flex-wrap items-center gap-3">
            <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center backdrop-blur-sm">
              <div class="text-2xl font-extrabold text-emerald-400">
                {{ careState.stats().compliancePercent }}%
              </div>
              <div class="text-xs font-medium text-slate-300">
                {{ careState.stats().completed }}/{{ careState.stats().total }} Done
              </div>
            </div>

            @if (careState.nextDueTask(); as nextTask) {
              <button
                type="button"
                (click)="careState.initiateCaregiverCall(nextTask.id)"
                class="flex items-center gap-3 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400"
              >
                <span class="text-lg">📞</span>
                <div class="text-left">
                  <div>Call {{ careState.config().caregiverTitle }} Now</div>
                  <div class="text-xs font-medium text-slate-900">
                    Next: {{ nextTask.title }}
                  </div>
                </div>
              </button>
            }
          </div>
        </div>

        <!-- Mini Status Pills -->
        <div class="mt-5 grid grid-cols-2 gap-2.5 border-t border-white/10 pt-4 sm:grid-cols-4">
          <div class="rounded-xl bg-white/5 px-3.5 py-2">
            <span class="text-xs text-slate-400">Completed Today</span>
            <p class="text-base font-bold text-emerald-400">
              {{ careState.stats().completed }} / {{ careState.stats().total }}
            </p>
          </div>
          <div class="rounded-xl bg-white/5 px-3.5 py-2">
            <span class="text-xs text-slate-400">Waiting on Meal Chain</span>
            <p class="text-base font-bold text-sky-300">
              {{ careState.stats().waiting }} tasks
            </p>
          </div>
          <div class="rounded-xl bg-white/5 px-3.5 py-2">
            <span class="text-xs text-slate-400">Active Snoozes</span>
            <p class="text-base font-bold text-amber-300">
              {{ careState.stats().snoozed }} tasks
            </p>
          </div>
          <div class="rounded-xl bg-white/5 px-3.5 py-2">
            <span class="text-xs text-slate-400">Escalated to {{ careState.config().escalationName }}</span>
            <p class="text-base font-bold text-rose-400">
              {{ careState.stats().escalated }} alerts
            </p>
          </div>
        </div>
      </section>

      <!-- Main 2-Column Layout: Left = Slim Chained Schedule Timeline, Right = Live Call & Escalation Logs -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <!-- Left 2 Columns: Slim Chained Care Timeline (Option A) -->
        <div class="space-y-3 lg:col-span-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-base font-bold text-slate-900 sm:text-lg">
                Today's Chained Recovery Timeline
              </h2>
              <p class="text-xs text-slate-500">
                Click <strong>🔊 Urdu Script</strong> on any row to open the Slide-Over Drawer &amp; hear Native Pakistani Urdu.
              </p>
            </div>
            <button
              type="button"
              (click)="careState.resetTodayProgress()"
              class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-2xs transition hover:bg-slate-100"
            >
              ↺ Reset Today's Demo State
            </button>
          </div>

          <div class="space-y-2">
            @for (task of careState.sortedTasks(); track task.id) {
              <div [class]="getCardClasses(task)">
                <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <!-- Left Info: Icon + Title + Status + Compact 1-Line Meta -->
                  <div class="flex items-center gap-3 min-w-0">
                    <div [class]="getCategoryBadgeClasses(task.category)">
                      {{ getCategoryIcon(task.category) }}
                    </div>

                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-mono text-xs font-bold text-slate-400">
                          #{{ task.order }}
                        </span>
                        <h3 class="truncate text-sm font-bold text-slate-900 sm:text-base">
                          {{ task.title }}
                        </h3>
                        <span [class]="getStatusBadgeClasses(task.status)">
                          {{ formatStatusLabel(task) }}
                        </span>
                        @if (task.triggerType === 'AFTER_TASK') {
                          <span
                            class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700"
                          >
                            🔗 +{{ task.offsetMinutes }}m
                          </span>
                        }
                      </div>

                      <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span class="font-mono font-semibold text-slate-700">
                          🕒 {{ task.scheduledTimeDisplay }}
                        </span>
                        <span class="truncate text-slate-600">
                          • {{ task.instructions }}
                        </span>
                        @if (task.snoozeCount > 0) {
                          <span class="font-semibold text-amber-700">
                            • Snoozed {{ task.snoozeCount }}/{{ careState.config().maxSnoozes }}x
                          </span>
                        }
                        @if (task.completedAt) {
                          <span class="font-semibold text-emerald-700">
                            • Done by {{ task.completedBy }} ({{ task.completedAt | date:'shortTime' }})
                          </span>
                        }
                      </div>
                    </div>
                  </div>

                  <!-- Right Action Buttons (Compact 1-Row) -->
                  <div class="flex flex-wrap items-center gap-1.5 shrink-0 sm:justify-end">
                    <button
                      type="button"
                      (click)="careState.openScriptDrawer(task.id)"
                      class="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50"
                      title="Open Slide-Over Drawer & Play Native Pakistani Urdu"
                    >
                      <span>🔊</span> Urdu Script
                    </button>

                    @if (task.status !== 'COMPLETED') {
                      <button
                        type="button"
                        (click)="careState.initiateCaregiverCall(task.id)"
                        class="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-emerald-500"
                      >
                        <span>📞</span> Call {{ careState.config().caregiverTitle }}
                      </button>

                      <button
                        type="button"
                        (click)="careState.escalateToSon(task.id, 'PATIENT_REFUSING')"
                        class="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                        title="Simulate patient refusing & escalate call"
                      >
                        <span>🚨</span> Escalate
                      </button>

                      <button
                        type="button"
                        (click)="careState.markTaskCompleted(task.id, 'Web Dashboard')"
                        class="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                      >
                        <span>✓</span> Done
                      </button>
                    } @else {
                      <span
                        class="inline-flex items-center gap-1 rounded-xl bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800"
                      >
                        ✓ Done
                      </span>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Right Column: Live Call & Escalation Log + Keypad Rules -->
        <div class="space-y-5">
          <!-- How Keypad & Escalation Works Card -->
          <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <h3 class="text-sm font-bold text-slate-900">
              📲 Active Call &amp; WhatsApp Verification Rules
            </h3>
            <p class="mt-0.5 text-xs text-slate-500">
              When Irhamhuma messages or calls <strong>{{ careState.config().caregiverTitle }}</strong> in Urdu:
            </p>
            <ul class="mt-2.5 space-y-2 text-xs text-slate-700">
              <li class="flex items-start gap-2">
                <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">1</span>
                <span>
                  <strong>Reply/Press 1 (Done):</strong> Marks completed &amp; unlocks chained tasks (<em>+15m Meds</em>, <em>+2h Boiled Eggs</em>).
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 font-bold text-amber-800">2</span>
                <span>
                  <strong>Reply/Press 2 (Snooze {{ careState.config().snoozeDurationMinutes }}m):</strong> Reminds {{ careState.config().caregiverTitle }} again in {{ careState.config().snoozeDurationMinutes }}m.
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 font-bold text-rose-800">3</span>
                <span>
                  <strong>Reply/Press 3 ({{ careState.config().patientTitle }} Refusing):</strong> Immediately escalates to <strong>{{ careState.config().escalationName }}</strong>!
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-800">9</span>
                <span>
                  <strong>Press 9 on {{ careState.config().escalationName }}'s Call:</strong> Uses Twilio <code>&lt;Dial&gt;</code> to live-bridge {{ careState.config().escalationName }} directly to {{ careState.config().caregiverTitle }}/{{ careState.config().patientTitle }}!
                </span>
              </li>
            </ul>
          </div>

          <!-- Live Call & Escalation Audit Log -->
          <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-slate-900">
                📡 Live Call &amp; Escalation Log
              </h3>
              <span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                {{ careState.allCallLogs().length }} events
              </span>
            </div>

            @if (careState.allCallLogs().length === 0) {
              <div class="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center">
                <p class="text-xs text-slate-500">
                  No calls placed yet today. Click <strong>"🔊 Urdu Script"</strong> or <strong>"📞 Call {{ careState.config().caregiverTitle }}"</strong> on any task to open the Slide-Over Drawer!
                </p>
              </div>
            } @else {
              <div class="mt-3 max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                @for (log of careState.allCallLogs(); track log.id) {
                  <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
                    <div class="flex items-center justify-between">
                      <span class="font-bold text-slate-800">
                        {{ log.taskTitle }}
                      </span>
                      <span class="font-mono text-xs text-slate-400">
                        {{ log.timestamp | date:'shortTime' }}
                      </span>
                    </div>
                    <p class="mt-1 text-slate-600">{{ log.notes }}</p>
                    <div class="mt-1.5 flex items-center gap-2">
                      <span
                        [class]="
                          log.targetRole === 'ESCALATION'
                            ? 'rounded bg-rose-100 px-1.5 py-0.5 text-xs font-bold text-rose-800'
                            : log.targetRole === 'BRIDGE'
                              ? 'rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-800'
                              : 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800'
                        "
                      >
                        {{ log.targetRole }}: {{ log.targetName }}
                      </span>
                      @if (log.digitPressed) {
                        <span class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-700">
                          Key: {{ log.digitPressed }}
                        </span>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DashboardComponent {
  readonly careState = inject(CareStateService);

  getCategoryIcon(category: TaskCategory): string {
    switch (category) {
      case 'MEAL':
        return '🍲';
      case 'MEDICATION':
        return '💊';
      case 'SNACK':
        return '🥚';
      case 'HYDRATION':
        return '🥛';
    }
  }

  getCategoryBadgeClasses(category: TaskCategory): string {
    const base = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ';
    switch (category) {
      case 'MEDICATION':
        return base + 'bg-rose-100 text-rose-700';
      case 'MEAL':
        return base + 'bg-emerald-100 text-emerald-700';
      case 'SNACK':
        return base + 'bg-amber-100 text-amber-700';
      case 'HYDRATION':
        return base + 'bg-sky-100 text-sky-700';
    }
  }

  getCardClasses(task: DailyTask): string {
    const base = 'rounded-xl border px-3.5 py-2.5 transition shadow-2xs ';
    const indent = task.triggerType === 'AFTER_TASK' ? 'ml-0 sm:ml-6 border-l-4 ' : '';
    switch (task.status) {
      case 'COMPLETED':
        return base + indent + 'border-emerald-200 bg-emerald-50/50 opacity-85';
      case 'ESCALATED':
      case 'BRIDGED':
        return base + indent + 'border-rose-300 bg-rose-50/70 ring-2 ring-rose-500/20';
      case 'SNOOZED':
      case 'RETRY_WAIT':
        return base + indent + 'border-amber-300 bg-amber-50/50';
      case 'WAITING_FOR_PARENT':
        return base + indent + 'border-slate-200 bg-slate-50/80 border-l-indigo-400';
      default:
        return base + indent + 'border-slate-200 bg-white hover:border-emerald-300';
    }
  }

  getStatusBadgeClasses(status: TaskStatus): string {
    const base = 'rounded-full px-2 py-0.5 text-xs font-bold ';
    switch (status) {
      case 'COMPLETED':
        return base + 'bg-emerald-100 text-emerald-800';
      case 'TIER1_NOTIFYING':
        return base + 'bg-green-600 text-white animate-pulse';
      case 'TIER2_NUDGING_SON':
        return base + 'bg-amber-500 text-slate-950 animate-pulse';
      case 'CALLING_CAREGIVER':
        return base + 'bg-emerald-600 text-white animate-pulse';
      case 'SNOOZED':
      case 'RETRY_WAIT':
        return base + 'bg-amber-100 text-amber-800';
      case 'ESCALATED':
        return base + 'bg-rose-600 text-white';
      case 'BRIDGED':
        return base + 'bg-indigo-600 text-white';
      case 'WAITING_FOR_PARENT':
        return base + 'bg-slate-200 text-slate-700';
      default:
        return base + 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    }
  }

  formatStatusLabel(task: DailyTask): string {
    const cfg = this.careState.config();
    switch (task.status) {
      case 'COMPLETED':
        return 'COMPLETED';
      case 'TIER1_NOTIFYING':
        return `WHATSAPP SENT TO ${cfg.caregiverTitle.toUpperCase()}`;
      case 'TIER2_NUDGING_SON':
        return `WHATSAPP NUDGE TO ${cfg.escalationName.toUpperCase()}`;
      case 'CALLING_CAREGIVER':
        return `CALLING ${cfg.caregiverTitle.toUpperCase()}...`;
      case 'RETRY_WAIT':
        return 'WAITING RETRY #2';
      case 'SNOOZED':
        return `SNOOZED (${cfg.snoozeDurationMinutes}M)`;
      case 'ESCALATED':
        return `ESCALATED TO ${cfg.escalationName.toUpperCase()}`;
      case 'BRIDGED':
        return 'LIVE CALL BRIDGED';
      case 'WAITING_FOR_PARENT':
        return 'WAITING FOR MEAL';
      default:
        return 'SCHEDULED';
    }
  }
}
