import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CareStateService } from '../../core/services/care-state.service';
import { GeminiAiService } from '../../core/services/gemini-ai.service';

@Component({
  selector: 'app-voice-simulator-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscapeKey()',
  },
  template: `
    @if (careState.activeCall(); as call) {
      <!-- Backdrop Overlay: Clicking outside closes the drawer -->
      <div
        class="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-xs transition-opacity"
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-sim-title"
        (click)="careState.closeCallModal()"
      >
        <!-- Slide-Over Right Drawer Panel (Shadcn / Linear style) -->
        <div
          class="relative flex h-dvh w-full max-w-md flex-col border-l border-slate-700 bg-slate-900 text-white shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <!-- 1. STICKY HEADER (Always accessible at top of viewport) -->
          <div
            [class]="
              call.mode === 'ESCALATION'
                ? 'shrink-0 bg-gradient-to-r from-rose-600 to-amber-600 px-5 py-4'
                : call.mode === 'BRIDGED'
                  ? 'shrink-0 bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4'
                  : 'shrink-0 bg-gradient-to-r from-emerald-700 to-teal-700 px-5 py-4'
            "
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="relative flex h-2.5 w-2.5">
                  <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"
                  ></span>
                  <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-white"></span>
                </span>
                <span class="text-xs font-bold tracking-wider uppercase text-white/90">
                  @switch (call.mode) {
                    @case ('CAREGIVER') {
                      Urdu Voice &amp; Call Control • Attempt #{{ call.attemptNumber }}
                    }
                    @case ('ESCALATION') {
                      Urgent Escalation • {{ call.escalationReason }}
                    }
                    @case ('BRIDGED') {
                      Twilio &lt;Dial&gt; Live Bridge Active
                    }
                  }
                </span>
              </div>

              <button
                type="button"
                (click)="careState.closeCallModal()"
                aria-label="Close voice drawer"
                class="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-black/30 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-black/50"
              >
                <span>✕ Close</span>
                <kbd class="rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs">Esc</kbd>
              </button>
            </div>

            <div class="mt-2.5 flex items-baseline justify-between gap-2">
              <div class="min-w-0">
                <h2 id="call-sim-title" class="truncate text-lg font-bold">
                  {{ call.taskTitle }}
                </h2>
                <p class="font-mono text-xs text-white/85">
                  To: {{ call.recipientName }} ({{ call.recipientPhone }})
                </p>
              </div>
              <span class="shrink-0 rounded-lg bg-black/25 px-2.5 py-1 text-xs font-semibold">
                {{ careState.config().voiceName }}
              </span>
            </div>
          </div>

          <!-- 2. SCROLLABLE BODY (Never overflows screen height) -->
          <div class="flex-1 space-y-4 overflow-y-auto p-5">
            <!-- Native Urdu Audio Player Card -->
            <div class="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-800/80 p-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold tracking-wider text-emerald-400 uppercase">
                  🔊 Native Pakistani Urdu (Cloud TTS)
                </span>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    (click)="toggleScriptEditor(call.spokenScriptNative, call.spokenScript)"
                    class="inline-flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-700/80 px-2.5 py-1 text-xs font-bold text-slate-200 transition hover:bg-slate-600"
                  >
                    <span>✏️</span>
                    @if (isEditingScript()) {
                      <span>Cancel Edit</span>
                    } @else {
                      <span>Edit &amp; Regenerate</span>
                    }
                  </button>
                  <button
                    type="button"
                    (click)="replayCloudNativeUrduAudio(call.taskId, call.spokenScriptNative)"
                    class="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-bold text-slate-950 transition hover:bg-amber-300"
                  >
                    <span>↻</span> Replay Urdu Audio
                  </button>
                </div>
              </div>

              <!-- Auto-Playing Native Urdu Cloud TTS Stream -->
              <audio
                [src]="activeAudioUrl()"
                controls
                autoplay
                class="h-10 w-full rounded-lg"
              ></audio>

              @if (isEditingScript()) {
                <div class="space-y-2.5 border-t border-slate-700 pt-3">
                  <div>
                    <label for="edit-urdu-native" class="block text-xs font-semibold text-emerald-300">
                      Nastaliq Urdu Script (Spoken by Google Cloud TTS):
                    </label>
                    <textarea
                      id="edit-urdu-native"
                      dir="rtl"
                      lang="ur"
                      rows="3"
                      [value]="draftUrduNative()"
                      (input)="onUrduNativeInput($event)"
                      class="font-urdu mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 p-2.5 text-sm text-emerald-100 focus:border-emerald-400 focus:outline-none"
                    ></textarea>
                  </div>
                  <div>
                    <label for="edit-urdu-roman" class="block text-xs font-semibold text-slate-300">
                      Roman Urdu Script:
                    </label>
                    <textarea
                      id="edit-urdu-roman"
                      rows="2"
                      [value]="draftUrduRoman()"
                      (input)="onUrduRomanInput($event)"
                      class="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 p-2.5 text-xs text-slate-200 focus:border-emerald-400 focus:outline-none"
                    ></textarea>
                  </div>
                  <button
                    type="button"
                    (click)="saveAndRegenerateScript(call.taskId)"
                    class="w-full rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
                  >
                    🔄 Save Script &amp; Regenerate Urdu Audio Now
                  </button>
                </div>
              } @else {
                @if (call.spokenScriptNative) {
                  <p
                    dir="rtl"
                    lang="ur"
                    class="font-urdu border-t border-slate-700/70 pt-3 text-base leading-relaxed text-emerald-100"
                  >
                    {{ call.spokenScriptNative }}
                  </p>
                }

                <p class="border-t border-slate-700/60 pt-2.5 text-xs leading-relaxed text-slate-300 italic">
                  "{{ call.spokenScript }}"
                </p>
              }

              <!-- Real Dispatch Action Buttons (WhatsApp + Twilio PSTN) -->
              <div class="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                <button
                  type="button"
                  (click)="sendWhatsAppUrduAlert(call.taskId)"
                  [disabled]="isSendingWhatsApp()"
                  class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-500 px-3 py-2.5 text-xs font-bold text-slate-950 shadow-sm transition hover:bg-green-400 disabled:opacity-50"
                >
                  @if (isSendingWhatsApp()) {
                    <span>Sending WhatsApp...</span>
                  } @else {
                    <span>💬 Send WhatsApp + Audio</span>
                  }
                </button>

                <button
                  type="button"
                  (click)="dialRealTwilioPhone(call.taskId, call.mode === 'ESCALATION' ? 'ESCALATION' : 'CAREGIVER')"
                  [disabled]="isDialingRealPhone()"
                  class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-400 px-3 py-2.5 text-xs font-bold text-slate-950 shadow-sm transition hover:bg-emerald-300 disabled:opacity-50"
                >
                  @if (isDialingRealPhone()) {
                    <span>Dialing Phone...</span>
                  } @else {
                    <span>📲 Dial Phone (Twilio)</span>
                  }
                </button>
              </div>
            </div>

            @if (call.lastFeedbackMessage) {
              <div
                class="rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-4 py-3 text-xs font-medium text-emerald-200"
              >
                {{ call.lastFeedbackMessage }}
              </div>
            }
          </div>

          <!-- 3. STICKY FOOTER KEYPAD (Always accessible without zooming out) -->
          <div class="shrink-0 space-y-3 border-t border-slate-800 bg-slate-950 p-4">
            @switch (call.mode) {
              @case ('CAREGIVER') {
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                      {{ careState.config().caregiverTitle }}'s Keypad Response:
                    </span>
                    <button
                      type="button"
                      (click)="careState.handleCaregiverNoAnswer(call.taskId)"
                      class="text-xs font-semibold text-rose-400 underline hover:text-rose-300"
                    >
                      📵 Simulate No Answer
                    </button>
                  </div>

                  <div class="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      (click)="careState.handleCaregiverDigit(call.taskId, '1')"
                      class="flex flex-col items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600/20 p-2.5 text-center transition hover:bg-emerald-600/35"
                    >
                      <span
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-slate-950"
                      >
                        1
                      </span>
                      <span class="mt-1 text-xs font-bold text-emerald-300">Done</span>
                      <span class="text-xs text-slate-400">+Unlocks chain</span>
                    </button>

                    <button
                      type="button"
                      (click)="careState.handleCaregiverDigit(call.taskId, '2')"
                      class="flex flex-col items-center justify-center rounded-xl border border-amber-500/40 bg-amber-600/20 p-2.5 text-center transition hover:bg-amber-600/35"
                    >
                      <span
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-slate-950"
                      >
                        2
                      </span>
                      <span class="mt-1 text-xs font-bold text-amber-300">
                        Snooze {{ careState.config().snoozeDurationMinutes }}m
                      </span>
                      <span class="text-xs text-slate-400">Call back later</span>
                    </button>

                    <button
                      type="button"
                      (click)="careState.handleCaregiverDigit(call.taskId, '3')"
                      class="flex flex-col items-center justify-center rounded-xl border border-rose-500/40 bg-rose-600/20 p-2.5 text-center transition hover:bg-rose-600/35"
                    >
                      <span
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white"
                      >
                        3
                      </span>
                      <span class="mt-1 text-xs font-bold text-rose-300">Refusing</span>
                      <span class="text-xs text-slate-400">
                        Call {{ careState.config().escalationName }}
                      </span>
                    </button>
                  </div>
                </div>
              }

              @case ('ESCALATION') {
                <div class="space-y-2">
                  <span class="block text-xs font-semibold tracking-wider text-rose-300 uppercase">
                    {{ careState.config().escalationName }}'s Escalation Keypad:
                  </span>
                  <div class="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      (click)="careState.handleEscalationDigit(call.taskId, '9')"
                      class="flex flex-col items-center justify-center rounded-xl border-2 border-indigo-400 bg-indigo-600/30 p-2.5 text-center transition hover:bg-indigo-600/50"
                    >
                      <span
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-400 text-sm font-bold text-slate-950"
                      >
                        9
                      </span>
                      <span class="mt-1 text-xs font-bold text-indigo-200">Bridge Call</span>
                      <span class="text-xs text-slate-300">Live &lt;Dial&gt;</span>
                    </button>

                    <button
                      type="button"
                      (click)="careState.handleEscalationDigit(call.taskId, '1')"
                      class="flex flex-col items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600/20 p-2.5 text-center transition hover:bg-emerald-600/35"
                    >
                      <span
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-slate-950"
                      >
                        1
                      </span>
                      <span class="mt-1 text-xs font-bold text-emerald-300">Resolved</span>
                      <span class="text-xs text-slate-400">Mark Done</span>
                    </button>

                    <button
                      type="button"
                      (click)="careState.handleEscalationDigit(call.taskId, '2')"
                      class="flex flex-col items-center justify-center rounded-xl border border-amber-500/40 bg-amber-600/20 p-2.5 text-center transition hover:bg-amber-600/35"
                    >
                      <span
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-slate-950"
                      >
                        2
                      </span>
                      <span class="mt-1 text-xs font-bold text-amber-300">Re-Call</span>
                      <span class="text-xs text-slate-400">
                        In {{ careState.config().snoozeDurationMinutes }}m
                      </span>
                    </button>
                  </div>
                </div>
              }

              @case ('BRIDGED') {
                <div class="space-y-2">
                  <p class="text-xs font-semibold text-teal-300">
                    🔗 Connected: {{ careState.config().escalationName }} ↔
                    {{ careState.config().caregiverTitle }} &amp; {{ careState.config().patientTitle }}
                  </p>
                  <div class="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      (click)="careState.handleEscalationDigit(call.taskId, '1')"
                      class="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                    >
                      ✓ Mark Completed
                    </button>
                    <button
                      type="button"
                      (click)="careState.handleEscalationDigit(call.taskId, '2')"
                      class="rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300"
                    >
                      ⏳ Re-Call in {{ careState.config().snoozeDurationMinutes }}m
                    </button>
                  </div>
                </div>
              }
            }

            <div class="flex items-center justify-between border-t border-slate-800/80 pt-2.5">
              <span class="text-xs text-slate-400">Click outside or press Esc to close</span>
              <button
                type="button"
                (click)="careState.closeCallModal()"
                class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Close Drawer (Esc)
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class VoiceSimulatorModalComponent {
  readonly careState = inject(CareStateService);
  readonly geminiService = inject(GeminiAiService);
  readonly manualReplayBust = signal<number>(0);
  readonly isDialingRealPhone = signal(false);
  readonly isSendingWhatsApp = signal(false);
  readonly isEditingScript = signal(false);
  readonly draftUrduNative = signal('');
  readonly draftUrduRoman = signal('');

  readonly activeAudioUrl = computed(() => {
    const call = this.careState.activeCall();
    if (!call) return '';
    const bust = this.manualReplayBust();
    return bust > 0 ? `${call.cloudAudioUrl}&_t=${bust}` : call.cloudAudioUrl;
  });

  onEscapeKey(): void {
    if (this.careState.activeCall()) {
      this.isEditingScript.set(false);
      this.careState.closeCallModal();
    }
  }

  toggleScriptEditor(currentNative: string, currentRoman: string): void {
    const next = !this.isEditingScript();
    if (next) {
      this.draftUrduNative.set(currentNative);
      this.draftUrduRoman.set(currentRoman);
    }
    this.isEditingScript.set(next);
  }

  onUrduNativeInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draftUrduNative.set(el.value);
  }

  onUrduRomanInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draftUrduRoman.set(el.value);
  }

  saveAndRegenerateScript(taskId: string): void {
    this.careState.updateTaskUrduScript(
      taskId,
      this.draftUrduNative(),
      this.draftUrduRoman()
    );
    this.isEditingScript.set(false);
    this.manualReplayBust.set(Date.now());
  }

  replayCloudNativeUrduAudio(_taskId: string, _urduNativeText: string): void {
    this.manualReplayBust.set(Date.now());
  }

  async sendWhatsAppUrduAlert(taskId: string): Promise<void> {
    this.isSendingWhatsApp.set(true);
    try {
      await this.careState.triggerWhatsAppAlert(taskId);
    } finally {
      this.isSendingWhatsApp.set(false);
    }
  }

  async dialRealTwilioPhone(
    taskId: string,
    role: 'CAREGIVER' | 'ESCALATION'
  ): Promise<void> {
    this.isDialingRealPhone.set(true);
    try {
      await this.careState.triggerRealTwilioCall(taskId, role);
    } finally {
      this.isDialingRealPhone.set(false);
    }
  }
}
