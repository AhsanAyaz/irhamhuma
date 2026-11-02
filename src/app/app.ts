import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CareStateService } from './core/services/care-state.service';
import { VoiceSimulatorModalComponent } from './features/simulator/voice-simulator-modal.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, VoiceSimulatorModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <!-- Top Dua & Navigation Bar -->
      <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div class="mx-auto flex max-w-7xl flex-col justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <!-- Brand + Quranic Dua -->
          <div class="flex items-center gap-3.5">
            <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-sm">
              🤲
            </div>
            <div>
              <div class="flex items-center gap-2.5">
                <span class="text-lg font-extrabold tracking-tight text-slate-900">
                  {{ careState.config().appName }}
                </span>
                <span
                  dir="rtl"
                  lang="ar"
                  class="font-arabic rounded-lg bg-emerald-50 px-2.5 py-0.5 text-sm font-bold text-emerald-800"
                >
                  رَّبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا
                </span>
              </div>
              <p class="text-xs text-slate-500">
                Caregiver Voice Automation for <strong>{{ careState.config().patientTitle }}</strong> •
                Primary: <strong>{{ careState.config().caregiverTitle }}</strong> •
                Escalation: <strong>{{ careState.config().escalationName }}</strong>
              </p>
            </div>
          </div>

          <!-- Navigation Links -->
          <nav class="flex flex-wrap items-center gap-1.5" aria-label="Main Navigation">
            <a
              routerLink="/"
              routerLinkActive="bg-emerald-600 text-white shadow-xs"
              [routerLinkActiveOptions]="{ exact: true }"
              class="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
            >
              📋 Live Care Timeline
            </a>
            <a
              routerLink="/kiosk"
              routerLinkActive="bg-emerald-600 text-white shadow-xs"
              class="rounded-xl px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 transition hover:bg-emerald-100"
            >
              📱 {{ careState.config().caregiverTitle }} Kiosk Mode ($0)
            </a>
            <a
              routerLink="/schedule"
              routerLinkActive="bg-emerald-600 text-white shadow-xs"
              class="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
            >
              ✨ AI Schedule Builder
            </a>
            <a
              routerLink="/architecture"
              routerLinkActive="bg-emerald-600 text-white shadow-xs"
              class="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
            >
              🏗️ Architecture &amp; TwiML
            </a>
            <a
              routerLink="/settings"
              routerLinkActive="bg-emerald-600 text-white shadow-xs"
              class="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
            >
              ⚙️ Settings ({{ careState.config().caregiverTitle }}/{{ careState.config().patientTitle }})
            </a>
          </nav>
        </div>
        @if (careState.isDemoMode()) {
          <div class="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center rounded-md bg-amber-200/80 px-2 py-0.5 font-extrabold text-amber-950">
                  🧪 Interactive Demo Mode (Local Browser Sandbox)
                </span>
                <span>
                  Changes here stay in your browser only and will <strong>not</strong> place real phone calls or affect live family schedules.
                  Want to run Irhamhuma for your own parents?
                  <a
                    href="https://github.com/AhsanAyaz/irhamhuma"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-extrabold text-emerald-800 underline hover:text-emerald-600"
                  >
                    Fork &amp; Self-Host on GitHub →
                  </a>
                </span>
              </div>
              <div class="flex items-center gap-2">
                <input
                  #passcodeInput
                  type="password"
                  placeholder="Family passcode..."
                  aria-label="Family passcode"
                  (keydown.enter)="careState.setDashboardApiKey(passcodeInput.value)"
                  class="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
                <button
                  type="button"
                  (click)="careState.setDashboardApiKey(passcodeInput.value)"
                  class="rounded-lg bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-500"
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        }
      </header>

      <!-- Main Route View -->
      <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <router-outlet />
      </main>

      <!-- Footer -->
      <footer class="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <div class="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row sm:px-6 lg:px-8">
          <span>
            <strong>Irhamhuma</strong> — Built with Angular Signals, Firebase, Gemini 2.5 Flash + Zod Structured Outputs, Cloud TTS &amp; Twilio Voice.
          </span>
          <span class="font-arabic text-sm text-emerald-700">
            رَّبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا (Al-Isra 17:24)
          </span>
        </div>
      </footer>

      <!-- Global Interactive Voice & Escalation Call Simulator Modal -->
      <app-voice-simulator-modal />
    </div>
  `,
})
export class App {
  readonly careState = inject(CareStateService);
}
