import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CareStateService } from '../../core/services/care-state.service';
import { DailyTask } from '../../core/models/care.models';

@Component({
  selector: 'app-caregiver-kiosk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <!-- Top Kiosk WakeLock & Cost-Saver Banner -->
      <div class="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-emerald-500/30 bg-slate-900 px-6 py-4 text-white shadow-lg">
        <div class="flex items-center gap-3">
          <span class="relative flex h-3.5 w-3.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500"></span>
          </span>
          <div>
            <h1 class="text-lg font-extrabold">
              📱 {{ careState.config().caregiverTitle }}'s Dedicated Caregiver Kiosk Mode ($0.00 Tier-1 Alarm)
            </h1>
            <p class="text-xs text-slate-300">
              Keep this page open on a phone or tablet at home. Confirming here cancels the Minute-5 paid Twilio call!
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            [class]="
              wakeLockActive()
                ? 'rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 border border-emerald-500/40'
                : 'rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-300 border border-amber-500/40'
            "
          >
            @if (wakeLockActive()) {
              🔆 Screen WakeLock Active (Won't Sleep)
            } @else {
              💡 Tap Anywhere to Keep Screen Awake
            }
          </span>
        </div>
      </div>

      <!-- Active / Next Due Task Giant Card for Caregiver -->
      @if (currentTask(); as task) {
        <div
          class="overflow-hidden rounded-3xl border-4 border-emerald-500 bg-white shadow-2xl"
          (click)="ensureWakeLock()"
        >
          <div class="bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 px-6 py-6 text-white sm:px-10">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="rounded-full bg-white/20 px-4 py-1 text-sm font-bold tracking-wide uppercase">
                🕒 {{ task.scheduledTimeDisplay }} • Task #{{ task.order }}
              </span>
              <button
                type="button"
                (click)="playNativeUrduCloudAudio(task)"
                class="inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-5 py-2.5 text-sm font-extrabold text-slate-950 shadow-md transition hover:bg-amber-300"
              >
                <span>🔊</span> آواز سنیں (Play Native Urdu Voice)
              </button>
            </div>

            <!-- Giant Urdu Title & Script -->
            <div dir="rtl" lang="ur" class="font-urdu mt-6 space-y-3 text-right">
              <h2 class="text-2xl font-bold text-emerald-200 sm:text-4xl">
                {{ careState.config().patientTitle }} کے لیے یاد دہانی: {{ task.title }}
              </h2>
              <p class="text-xl leading-loose text-white sm:text-2xl">
                {{ task.urduScriptNative }}
              </p>
            </div>

            <div class="mt-4 border-t border-white/15 pt-4">
              <p class="text-base font-bold text-emerald-100">
                {{ task.title }} — {{ task.instructions }}
              </p>
            </div>

            @if (audioSrcUrl(); as srcUrl) {
              <div class="mt-4">
                <audio [src]="srcUrl" controls autoplay class="h-10 w-full"></audio>
              </div>
            }
          </div>

          <!-- 3 Giant Touch Buttons for Caregiver -->
          <div class="space-y-4 bg-slate-50 p-6 sm:p-8">
            <p dir="rtl" lang="ur" class="font-urdu text-center text-lg font-bold text-slate-700">
              براہ کرم نیچے دیے گئے بٹن کو دبائیں:
            </p>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <!-- Button 1: Done -->
              <button
                type="button"
                (click)="onCaregiverTap(task, '1')"
                class="flex flex-col items-center justify-center rounded-3xl border-2 border-emerald-600 bg-emerald-600 p-6 text-white shadow-xl transition hover:bg-emerald-500 active:scale-98"
              >
                <span class="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl font-black text-emerald-700">
                  1
                </span>
                <span dir="rtl" lang="ur" class="font-urdu mt-4 text-2xl font-bold">
                  ✅ جی، {{ careState.config().patientTitle }} نے لے لی
                </span>
                <span class="mt-2 text-sm font-semibold text-emerald-100">
                  Completed (Unlocks Next Task)
                </span>
              </button>

              <!-- Button 2: Snooze 15m -->
              <button
                type="button"
                (click)="onCaregiverTap(task, '2')"
                class="flex flex-col items-center justify-center rounded-3xl border-2 border-amber-500 bg-amber-500 p-6 text-slate-950 shadow-xl transition hover:bg-amber-400 active:scale-98"
              >
                <span class="flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-2xl font-black text-amber-400">
                  2
                </span>
                <span dir="rtl" lang="ur" class="font-urdu mt-4 text-2xl font-bold">
                  ⏳ {{ careState.config().snoozeDurationMinutes }} منٹ بعد یاد دلائیں
                </span>
                <span class="mt-2 text-sm font-bold text-slate-900">
                  Snooze {{ careState.config().snoozeDurationMinutes }} Minutes
                </span>
              </button>

              <!-- Button 3: Refusing / Escalate -->
              <button
                type="button"
                (click)="onCaregiverTap(task, '3')"
                class="flex flex-col items-center justify-center rounded-3xl border-2 border-rose-600 bg-rose-600 p-6 text-white shadow-xl transition hover:bg-rose-500 active:scale-98"
              >
                <span class="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl font-black text-rose-600">
                  3
                </span>
                <span dir="rtl" lang="ur" class="font-urdu mt-4 text-2xl font-bold">
                  🚨 {{ careState.config().patientTitle }} منع کر رہے ہیں
                </span>
                <span class="mt-2 text-sm font-semibold text-rose-100">
                  Call {{ careState.config().escalationName }} Immediately
                </span>
              </button>
            </div>

            @if (lastKioskActionMessage(); as msg) {
              <div
                dir="rtl"
                lang="ur"
                class="font-urdu mt-4 rounded-2xl border border-emerald-400 bg-emerald-100 p-4 text-center text-xl font-bold text-emerald-900"
              >
                {{ msg }}
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="rounded-3xl border border-emerald-200 bg-emerald-50 p-12 text-center">
          <div class="text-5xl">🤲</div>
          <h2 dir="rtl" lang="ur" class="font-urdu mt-4 text-3xl font-bold text-emerald-900">
            الحمد للہ! آج کی تمام دوائیں اور کھانے مکمل ہو چکے ہیں۔
          </h2>
          <p class="mt-2 text-sm text-emerald-700">
            All scheduled care tasks for {{ careState.config().patientTitle }} are completed for today!
          </p>
        </div>
      }
    </div>
  `,
})
export class CaregiverKioskComponent implements OnInit, OnDestroy {
  readonly careState = inject(CareStateService);
  readonly wakeLockActive = signal(false);
  readonly audioSrcUrl = signal<string | null>(null);
  readonly lastKioskActionMessage = signal<string | null>(null);

  private wakeLockSentinel: WakeLockSentinel | null = null;

  readonly currentTask = computed(() => this.careState.nextDueTask());

  ngOnInit(): void {
    this.ensureWakeLock();
  }

  ngOnDestroy(): void {
    this.releaseWakeLock();
  }

  async ensureWakeLock(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
        this.wakeLockActive.set(true);
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockActive.set(false);
        });
      } catch {
        this.wakeLockActive.set(false);
      }
    }
  }

  playNativeUrduCloudAudio(task: DailyTask): void {
    this.playChimeTone();
    const url = this.careState.getCloudUrduAudioStreamUrl(task.id, task.urduScriptNative);
    this.audioSrcUrl.set(url);
  }

  onCaregiverTap(task: DailyTask, digit: '1' | '2' | '3'): void {
    this.careState.handleCaregiverDigit(task.id, digit);
    const c = this.careState.config().caregiverTitle;
    const p = this.careState.config().patientTitle;
    const e = this.careState.config().escalationName;

    if (digit === '1') {
      const msg = `جزاک اللہ ${c}! "${task.title}" مکمل ہو گیا ہے اور اگلی دوائی کا وقت سیٹ کر دیا گیا ہے۔`;
      this.lastKioskActionMessage.set(msg);
      this.audioSrcUrl.set(this.careState.getCloudUrduAudioStreamUrl(task.id, msg));
    } else if (digit === '2') {
      const msg = `ٹھیک ہے ${c}، ${this.careState.config().snoozeDurationMinutes} منٹ بعد دوبارہ یاد دلائیں گے۔`;
      this.lastKioskActionMessage.set(msg);
      this.audioSrcUrl.set(this.careState.getCloudUrduAudioStreamUrl(task.id, msg));
    } else {
      const msg = `پریشان نہ ہوں ${c}، ابھی ${e} کو اطلاع دی جا رہی ہے کہ ${p} منع کر رہے ہیں۔`;
      this.lastKioskActionMessage.set(msg);
      this.audioSrcUrl.set(this.careState.getCloudUrduAudioStreamUrl(task.id, msg));
    }
  }

  private playChimeTone(): void {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.18); // A5
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch {
      // Ignore audio context restrictions
    }
  }

  private releaseWakeLock(): void {
    if (this.wakeLockSentinel) {
      this.wakeLockSentinel.release().catch(() => {});
      this.wakeLockSentinel = null;
    }
  }
}
