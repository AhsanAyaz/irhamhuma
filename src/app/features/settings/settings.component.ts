import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CareStateService } from '../../core/services/care-state.service';
import {
  EscalationChannel,
  NotificationChannel,
  TtsEngine,
  WhatsAppProvider,
} from '../../core/models/care.models';

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs sm:p-8">
        <div class="border-b border-slate-200 pb-5">
          <h1 class="text-2xl font-bold text-slate-900">
            Family Personas, 3-Tier Cost-Saver Cascade &amp; Telephony Settings
          </h1>
          <p class="mt-1 text-sm text-slate-500">
            Configure respectful family titles, the WhatsApp + Native Voice Note cascade, and the Minute-5 Twilio cellular call safety net.
          </p>
        </div>

        <form [formGroup]="settingsForm" (ngSubmit)="saveSettings()" class="mt-6 space-y-6">
          <!-- 1. Family Titles Section -->
          <div>
            <h2 class="text-sm font-bold tracking-wider text-emerald-700 uppercase">
              1. Configurable Family Titles (Used in Native Urdu Voice Prompts)
            </h2>
            <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label for="patientTitle" class="block text-xs font-semibold text-slate-700">
                  Patient Title (Father)
                </label>
                <input
                  id="patientTitle"
                  type="text"
                  formControlName="patientTitle"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label for="caregiverTitle" class="block text-xs font-semibold text-slate-700">
                  Primary Caregiver Title (Mother)
                </label>
                <input
                  id="caregiverTitle"
                  type="text"
                  formControlName="caregiverTitle"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label for="escalationName" class="block text-xs font-semibold text-slate-700">
                  Escalation Contact Name (You)
                </label>
                <input
                  id="escalationName"
                  type="text"
                  formControlName="escalationName"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <!-- 2. Caregiver-First WhatsApp + Voice Cascade -->
          <div class="border-t border-slate-100 pt-6">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="text-sm font-bold tracking-wider text-green-700 uppercase">
                  2. Caregiver-First WhatsApp &amp; Voice Cascade
                </h2>
                <p class="mt-0.5 text-xs text-slate-500">
                  Min 0: WhatsApp + Urdu Voice Note to {{ settingsForm.controls.caregiverTitle.value }} -> Min 5: Call {{ settingsForm.controls.caregiverTitle.value }} (WhatsApp Call + Cellular Fallback) -> Escalates to {{ settingsForm.controls.escalationName.value }} only if unanswered.
                </p>
              </div>
              <label class="inline-flex items-center gap-2 text-xs font-bold text-slate-800">
                <input
                  type="checkbox"
                  formControlName="enableCostSaverCascade"
                  class="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                Enable WhatsApp Cascade
              </label>
            </div>

            <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                <label class="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    formControlName="notifyEscalationOnCompletion"
                    class="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <div>
                    <span class="block text-xs font-bold text-slate-900">
                      Notify {{ settingsForm.controls.escalationName.value }} on Done
                    </span>
                    <span class="mt-0.5 block text-xs text-slate-600">
                      Sends a short text-only confirmation via Telegram ($0.00) whenever a task is confirmed by {{ settingsForm.controls.caregiverTitle.value }}.
                    </span>
                  </div>
                </label>
              </div>

              <div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                <label class="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    formControlName="enableWhatsAppAudioNote"
                    class="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <div>
                    <span class="block text-xs font-bold text-slate-900">
                      🔊 Attach Urdu MP3 on WhatsApp
                    </span>
                    <span class="mt-0.5 block text-xs text-slate-600">
                      Uncheck to send 1 single text message per reminder ($0.005/msg) instead of a 2nd MP3 audio message (cuts WhatsApp cost in half).
                    </span>
                  </div>
                </label>
              </div>

              <div class="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
                <label class="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    formControlName="enableTwilioCalls"
                    class="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <div>
                    <span class="block text-xs font-bold text-slate-900">
                      📞 Enable Outbound Twilio Calls
                    </span>
                    <span class="mt-0.5 block text-xs text-slate-600">
                      Uncheck to disable paid PSTN phone calls ($0 voice spend). Uses WhatsApp / Telegram messages only.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label for="caregiverChannel" class="block text-xs font-semibold text-slate-700">
                  {{ settingsForm.controls.caregiverTitle.value }}'s Messaging Channel
                </label>
                <select
                  id="caregiverChannel"
                  formControlName="caregiverChannel"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="WHATSAPP">WhatsApp (Recommended where Telegram is restricted, e.g. Pakistan)</option>
                  <option value="TELEGRAM">Telegram Bot ($0.00 Free • Audio + 1-Tap Inline Buttons)</option>
                  <option value="BOTH">Both WhatsApp &amp; Telegram</option>
                </select>
              </div>

              <div>
                <label for="escalationChannel" class="block text-xs font-semibold text-slate-700">
                  {{ settingsForm.controls.escalationName.value }}'s Notification Channel
                </label>
                <select
                  id="escalationChannel"
                  formControlName="escalationChannel"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="TELEGRAM">Telegram Bot ($0.00 Free • No 24-Hour Window Limit)</option>
                  <option value="WHATSAPP">WhatsApp (Requires active 24h window)</option>
                  <option value="BOTH">Both Telegram &amp; WhatsApp</option>
                </select>
              </div>

              <div>
                <label for="whatsappProvider" class="block text-xs font-semibold text-slate-700">
                  WhatsApp Provider
                </label>
                <select
                  id="whatsappProvider"
                  formControlName="whatsappProvider"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="META_CLOUD_API">Meta Direct WhatsApp Cloud API ($0.00 Free • No $20 Prepay)</option>
                  <option value="TWILIO">Twilio WhatsApp ($0.005/msg • Requires $20 Min Prepay)</option>
                </select>
              </div>

              <div>
                <label for="twilioWhatsappNumber" class="block text-xs font-semibold text-slate-700">
                  Twilio WhatsApp Sender Number (If using Twilio)
                </label>
                <input
                  id="twilioWhatsappNumber"
                  type="tel"
                  formControlName="twilioWhatsappNumber"
                  placeholder="+10000000000"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <!-- Meta Direct WhatsApp Cloud API ($0.00 Free • No $20 Prepay) -->
            <div class="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
              <h3 class="text-xs font-bold tracking-wider text-emerald-800 uppercase">
                💬 Meta Direct WhatsApp Cloud API ($0.00 Free • Native 1-Tap Reply Buttons • No $20 Minimum)
              </h3>
              <p class="mt-1 text-xs text-slate-600">
                📌 <strong>Meta Webhook Callback URL:</strong>
                <code class="ml-1 select-all rounded bg-white px-1.5 py-0.5 font-bold text-emerald-800">{{ metaWebhookUrlPreview }}</code>
                • <strong>Verify Token:</strong>
                <code class="ml-1 select-all rounded bg-white px-1.5 py-0.5 font-bold text-emerald-800">{{ settingsForm.controls.metaVerifyToken.value }}</code>
              </p>

              <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label for="metaPhoneNumberId" class="block text-xs font-semibold text-slate-700">
                    Meta Phone Number ID
                  </label>
                  <input
                    id="metaPhoneNumberId"
                    type="text"
                    formControlName="metaPhoneNumberId"
                    placeholder="e.g. 102938475610293"
                    class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label for="metaAccessToken" class="block text-xs font-semibold text-slate-700">
                    Meta WhatsApp Access Token
                  </label>
                  <input
                    id="metaAccessToken"
                    type="password"
                    formControlName="metaAccessToken"
                    placeholder="EAAG..."
                    class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label for="metaVerifyToken" class="block text-xs font-semibold text-slate-700">
                    Webhook Verify Token
                  </label>
                  <input
                    id="metaVerifyToken"
                    type="text"
                    formControlName="metaVerifyToken"
                    placeholder="irhamhuma_meta_verify"
                    class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <!-- Telegram Bot Configuration ($0.00 Free Messaging) -->
            <div class="mt-4 rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
              <h3 class="text-xs font-bold tracking-wider text-sky-800 uppercase">
                ✈️ Telegram Bot Integration ($0.00 Free • No 24-Hour Window Restriction)
              </h3>
              <p class="mt-1 text-xs text-slate-600">
                1. Message <strong>&#64;BotFather</strong> on Telegram -> <code>/newbot</code> and paste the token below. 2. Click <strong>Save Configuration</strong> (auto-registers webhook). 3. Send <code>/start</code> to your bot on Telegram to get your Chat ID.
              </p>

              <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div class="sm:col-span-1">
                  <label for="telegramBotToken" class="block text-xs font-semibold text-slate-700">
                    Telegram Bot Token (&#64;BotFather)
                  </label>
                  <input
                    id="telegramBotToken"
                    type="password"
                    formControlName="telegramBotToken"
                    placeholder="123456:ABC-DEF..."
                    class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label for="escalationTelegramChatId" class="block text-xs font-semibold text-slate-700">
                    {{ settingsForm.controls.escalationName.value }}'s Telegram Chat ID
                  </label>
                  <input
                    id="escalationTelegramChatId"
                    type="text"
                    formControlName="escalationTelegramChatId"
                    placeholder="e.g. 123456789"
                    class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label for="caregiverTelegramChatId" class="block text-xs font-semibold text-slate-700">
                    {{ settingsForm.controls.caregiverTitle.value }}'s Telegram Chat ID (Optional)
                  </label>
                  <input
                    id="caregiverTelegramChatId"
                    type="text"
                    formControlName="caregiverTelegramChatId"
                    placeholder="Optional if using WhatsApp"
                    class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Phone Numbers Section -->
          <div class="border-t border-slate-100 pt-6">
            <h2 class="text-sm font-bold tracking-wider text-emerald-700 uppercase">
              3. Cellular Phone Numbers (Twilio PSTN Fallback &amp; Press-9 Live Call Bridging)
            </h2>
            <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label for="caregiverPhone" class="block text-xs font-semibold text-slate-700">
                  {{ settingsForm.controls.caregiverTitle.value }}'s Cellular Number
                </label>
                <input
                  id="caregiverPhone"
                  type="tel"
                  formControlName="caregiverPhone"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label for="escalationPhone" class="block text-xs font-semibold text-slate-700">
                  {{ settingsForm.controls.escalationName.value }}'s Cellular Number
                </label>
                <input
                  id="escalationPhone"
                  type="tel"
                  formControlName="escalationPhone"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label for="patientPhone" class="block text-xs font-semibold text-slate-700">
                  {{ settingsForm.controls.patientTitle.value }}'s Direct Phone (Optional)
                </label>
                <input
                  id="patientPhone"
                  type="tel"
                  formControlName="patientPhone"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <!-- 4. Timing & Voice Synthesis Rules -->
          <div class="border-t border-slate-100 pt-6">
            <h2 class="text-sm font-bold tracking-wider text-emerald-700 uppercase">
              4. Escalation Timers &amp; Native Urdu Google Cloud TTS Voice
            </h2>
            <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label for="tier2NudgeAfterMinutes" class="block text-xs font-semibold text-slate-700">
                  Tier-2 Nudge to {{ settingsForm.controls.escalationName.value }} (Mins)
                </label>
                <input
                  id="tier2NudgeAfterMinutes"
                  type="number"
                  formControlName="tier2NudgeAfterMinutes"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label for="tier3TwilioFallbackAfterMinutes" class="block text-xs font-semibold text-slate-700">
                  Tier-3 Paid Twilio Call After (Mins)
                </label>
                <input
                  id="tier3TwilioFallbackAfterMinutes"
                  type="number"
                  formControlName="tier3TwilioFallbackAfterMinutes"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label for="snoozeDurationMinutes" class="block text-xs font-semibold text-slate-700">
                  Snooze Duration (Minutes on Key 2)
                </label>
                <input
                  id="snoozeDurationMinutes"
                  type="number"
                  formControlName="snoozeDurationMinutes"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label for="voiceName" class="block text-xs font-semibold text-slate-700">
                  Google Cloud TTS Voice (Urdu / Hindi / Arabic / Bengali / English)
                </label>
                <select
                  id="voiceName"
                  formControlName="voiceName"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="ur-PK-Standard-A">ur-PK-Standard-A (Pakistan Urdu Female — Recommended)</option>
                  <option value="ur-IN-Wavenet-A">ur-IN-Wavenet-A (Urdu WaveNet Female)</option>
                  <option value="ur-IN-Wavenet-B">ur-IN-Wavenet-B (Urdu WaveNet Male)</option>
                  <option value="hi-IN-Wavenet-A">hi-IN-Wavenet-A (Hindi WaveNet Female)</option>
                  <option value="hi-IN-Wavenet-B">hi-IN-Wavenet-B (Hindi WaveNet Male)</option>
                  <option value="ar-XA-Wavenet-A">ar-XA-Wavenet-A (Arabic WaveNet Female)</option>
                  <option value="bn-IN-Wavenet-A">bn-IN-Wavenet-A (Bengali WaveNet Female)</option>
                  <option value="en-US-Wavenet-F">en-US-Wavenet-F (English WaveNet Female)</option>
                </select>
              </div>

              <div class="sm:col-span-2">
                <label for="geminiApiKey" class="block text-xs font-semibold text-slate-700">
                  Gemini API Key (For Browser Prescription Scanner &amp; Schedule Builder)
                </label>
                <input
                  id="geminiApiKey"
                  type="password"
                  formControlName="geminiApiKey"
                  placeholder="AIzaSy..."
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between border-t border-slate-200 pt-5">
            @if (savedBanner()) {
              <span class="rounded-xl bg-emerald-100 px-3.5 py-2 text-xs font-bold text-emerald-800">
                ✓ Settings saved and applied!
              </span>
            } @else {
              <span></span>
            }

            <button
              type="submit"
              class="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
            >
              💾 Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class SettingsComponent {
  readonly careState = inject(CareStateService);
  private readonly fb = inject(FormBuilder);
  readonly savedBanner = signal(false);
  readonly webhookUrlPreview =
    typeof window !== 'undefined'
      ? `${window.location.origin}/twiml/whatsapp-webhook`
      : '/twiml/whatsapp-webhook';
  readonly metaWebhookUrlPreview =
    typeof window !== 'undefined'
      ? `${window.location.origin}/twiml/meta-whatsapp-webhook`
      : '/twiml/meta-whatsapp-webhook';

  readonly settingsForm = this.fb.nonNullable.group({
    patientTitle: [this.careState.config().patientTitle, [Validators.required]],
    caregiverTitle: [this.careState.config().caregiverTitle, [Validators.required]],
    escalationName: [this.careState.config().escalationName, [Validators.required]],
    caregiverPhone: [this.careState.config().caregiverPhone, [Validators.required]],
    patientPhone: [this.careState.config().patientPhone],
    escalationPhone: [this.careState.config().escalationPhone, [Validators.required]],
    snoozeDurationMinutes: [this.careState.config().snoozeDurationMinutes, [Validators.required]],
    maxSnoozes: [this.careState.config().maxSnoozes, [Validators.required]],
    retryDelayMinutes: [this.careState.config().retryDelayMinutes, [Validators.required]],
    ttsEngine: [this.careState.config().ttsEngine as TtsEngine],
    voiceName: [this.careState.config().voiceName || 'ur-PK-Standard-A'],
    geminiVoiceName: [this.careState.config().geminiVoiceName],
    geminiApiKey: [this.careState.config().geminiApiKey ?? ''],
    enableCostSaverCascade: [this.careState.config().enableCostSaverCascade],
    enableTwilioCalls: [this.careState.config().enableTwilioCalls ?? false],
    enableWhatsAppAudioNote: [this.careState.config().enableWhatsAppAudioNote ?? false],
    notifyEscalationOnCompletion: [this.careState.config().notifyEscalationOnCompletion ?? true],
    caregiverChannel: [
      (this.careState.config().caregiverChannel || 'WHATSAPP') as NotificationChannel,
    ],
    escalationChannel: [
      (this.careState.config().escalationChannel || 'TELEGRAM') as EscalationChannel,
    ],
    tier2NudgeAfterMinutes: [this.careState.config().tier2NudgeAfterMinutes],
    tier3TwilioFallbackAfterMinutes: [this.careState.config().tier3TwilioFallbackAfterMinutes],
    whatsappProvider: [
      (this.careState.config().whatsappProvider || 'TWILIO') as WhatsAppProvider,
    ],
    twilioWhatsappNumber: [this.careState.config().twilioWhatsappNumber || ''],
    metaPhoneNumberId: [this.careState.config().metaPhoneNumberId ?? ''],
    metaAccessToken: [this.careState.config().metaAccessToken ?? ''],
    metaVerifyToken: [
      this.careState.config().metaVerifyToken || 'irhamhuma_meta_verify',
    ],
    telegramBotToken: [this.careState.config().telegramBotToken ?? ''],
    caregiverTelegramChatId: [this.careState.config().caregiverTelegramChatId ?? ''],
    escalationTelegramChatId: [this.careState.config().escalationTelegramChatId ?? ''],
    caregiverTelegramUsername: [this.careState.config().caregiverTelegramUsername ?? ''],
    enableCallMeBotVoiceCall: [this.careState.config().enableCallMeBotVoiceCall],
  });

  constructor() {
    effect(() => {
      const cfg = this.careState.config();
      this.settingsForm.patchValue(
        {
          patientTitle: cfg.patientTitle,
          caregiverTitle: cfg.caregiverTitle,
          escalationName: cfg.escalationName,
          caregiverPhone: cfg.caregiverPhone,
          patientPhone: cfg.patientPhone,
          escalationPhone: cfg.escalationPhone,
          snoozeDurationMinutes: cfg.snoozeDurationMinutes,
          maxSnoozes: cfg.maxSnoozes,
          retryDelayMinutes: cfg.retryDelayMinutes,
          ttsEngine: cfg.ttsEngine as TtsEngine,
          voiceName: cfg.voiceName || 'ur-PK-Standard-A',
          geminiVoiceName: cfg.geminiVoiceName,
          geminiApiKey: cfg.geminiApiKey ?? '',
          enableCostSaverCascade: cfg.enableCostSaverCascade,
          enableTwilioCalls: cfg.enableTwilioCalls ?? false,
          enableWhatsAppAudioNote: cfg.enableWhatsAppAudioNote ?? false,
          notifyEscalationOnCompletion: cfg.notifyEscalationOnCompletion ?? true,
          caregiverChannel: (cfg.caregiverChannel || 'WHATSAPP') as NotificationChannel,
          escalationChannel: (cfg.escalationChannel || 'TELEGRAM') as EscalationChannel,
          tier2NudgeAfterMinutes: cfg.tier2NudgeAfterMinutes,
          tier3TwilioFallbackAfterMinutes: cfg.tier3TwilioFallbackAfterMinutes,
          whatsappProvider: (cfg.whatsappProvider || 'TWILIO') as WhatsAppProvider,
          twilioWhatsappNumber: cfg.twilioWhatsappNumber || '',
          metaPhoneNumberId: cfg.metaPhoneNumberId ?? '',
          metaAccessToken: cfg.metaAccessToken ?? '',
          metaVerifyToken: cfg.metaVerifyToken || 'irhamhuma_meta_verify',
          telegramBotToken: cfg.telegramBotToken ?? '',
          caregiverTelegramChatId: cfg.caregiverTelegramChatId ?? '',
          escalationTelegramChatId: cfg.escalationTelegramChatId ?? '',
          caregiverTelegramUsername: cfg.caregiverTelegramUsername ?? '',
          enableCallMeBotVoiceCall: cfg.enableCallMeBotVoiceCall,
        },
        { emitEvent: false }
      );
    });
  }

  saveSettings(): void {
    const raw = this.settingsForm.getRawValue();
    this.careState.updateConfig({
      patientTitle: raw.patientTitle,
      caregiverTitle: raw.caregiverTitle,
      escalationName: raw.escalationName,
      caregiverPhone: raw.caregiverPhone,
      patientPhone: raw.patientPhone,
      escalationPhone: raw.escalationPhone,
      snoozeDurationMinutes: Number(raw.snoozeDurationMinutes),
      maxSnoozes: Number(raw.maxSnoozes),
      retryDelayMinutes: Number(raw.retryDelayMinutes),
      ttsEngine: raw.ttsEngine,
      voiceName: raw.voiceName,
      geminiVoiceName: raw.geminiVoiceName,
      geminiApiKey: raw.geminiApiKey,
      enableCostSaverCascade: Boolean(raw.enableCostSaverCascade),
      enableTwilioCalls: Boolean(raw.enableTwilioCalls),
      enableWhatsAppAudioNote: Boolean(raw.enableWhatsAppAudioNote),
      notifyEscalationOnCompletion: Boolean(raw.notifyEscalationOnCompletion),
      caregiverChannel: raw.caregiverChannel,
      escalationChannel: raw.escalationChannel,
      tier2NudgeAfterMinutes: Number(raw.tier2NudgeAfterMinutes),
      tier3TwilioFallbackAfterMinutes: Number(raw.tier3TwilioFallbackAfterMinutes),
      whatsappProvider: raw.whatsappProvider,
      twilioWhatsappNumber: raw.twilioWhatsappNumber,
      metaPhoneNumberId: raw.metaPhoneNumberId,
      metaAccessToken: raw.metaAccessToken,
      metaVerifyToken: raw.metaVerifyToken || 'irhamhuma_meta_verify',
      telegramBotToken: raw.telegramBotToken,
      caregiverTelegramChatId: raw.caregiverTelegramChatId,
      escalationTelegramChatId: raw.escalationTelegramChatId,
      caregiverTelegramUsername: raw.caregiverTelegramUsername,
      enableCallMeBotVoiceCall: Boolean(raw.enableCallMeBotVoiceCall),
    });
    this.savedBanner.set(true);
    setTimeout(() => this.savedBanner.set(false), 3000);
  }
}
