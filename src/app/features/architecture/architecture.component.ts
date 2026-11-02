import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CareStateService } from '../../core/services/care-state.service';

@Component({
  selector: 'app-architecture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-8">
      <section class="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs sm:p-8">
        <div class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          Google Developers Expert (AI) Showcase Reference
        </div>
        <h1 class="mt-2 text-2xl font-bold text-slate-900">
          Irhamhuma System Architecture, Gemini + Zod Schema &amp; Twilio Webhooks
        </h1>
        <p class="mt-1 text-sm text-slate-600">
          Full reference documentation is also saved in the repository at
          <code class="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-800">
            docs/ARCHITECTURE_AND_PLAN.md
          </code>
          and backend Cloud Functions at
          <code class="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-800">
            functions/src/
          </code>.
        </p>

        <!-- 3 Architectural Pillars -->
        <div class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 class="text-sm font-bold text-slate-900">
              1. Gemini 2.5 Flash + Zod Structured Outputs
            </h3>
            <p class="mt-1 text-xs text-slate-600">
              Uses <code>&#64;google/genai</code> with <code>responseMimeType: 'application/json'</code>,
              <code>zodToJsonSchema(ParsedScheduleResponseSchema)</code>, and strict runtime
              <code>.parse()</code> validation to extract fixed times and meal-chained offsets
              (<code>+15m meds</code>, <code>+120m boiled eggs</code>).
            </p>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 class="text-sm font-bold text-slate-900">
              2. Hybrid WhatsApp + Telegram ($0.00) &amp; Native TTS
            </h3>
            <p class="mt-1 text-xs text-slate-600">
              Streams native Google Cloud TTS (<code>ur-PK-Standard-A</code> / <code>ur-IN-Wavenet-A</code>)
              at <code>0.90x</code> speed to WhatsApp &amp; Telegram voice notes, and sends instant
              <code>$0.00</code> Telegram completion &amp; escalation updates without Meta's 24-hour window limit.
            </p>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 class="text-sm font-bold text-slate-900">
              3. Caregiver-First Verification &amp; Press-9 Bridge
            </h3>
            <p class="mt-1 text-xs text-slate-600">
              Messages {{ careState.config().caregiverTitle }} at Min 0, then calls at Min 5 (WhatsApp Call +
              Cellular fallback). Only after 2 missed calls or Press <code>3</code> does it alert &amp; call
              {{ careState.config().escalationName }}, where Press <code>9</code> bridges live via Twilio <code>&lt;Dial&gt;</code>.
            </p>
          </div>
        </div>
      </section>

      <!-- Live TwiML Payloads Preview -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-slate-100 shadow-2xs">
          <h3 class="text-xs font-bold tracking-wider text-emerald-400 uppercase">
            1. Caregiver TwiML Webhook (/twiml/caregiver) — Calling {{ careState.config().caregiverTitle }}
          </h3>
          <pre class="mt-3 overflow-x-auto text-xs leading-relaxed text-emerald-200"><code>{{ sampleCaregiverTwiml() }}</code></pre>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-slate-100 shadow-2xs">
          <h3 class="text-xs font-bold tracking-wider text-rose-400 uppercase">
            2. Escalation &amp; Press-9 Live Bridge TwiML (/twiml/escalation) — Calling {{ careState.config().escalationName }}
          </h3>
          <pre class="mt-3 overflow-x-auto text-xs leading-relaxed text-rose-200"><code>{{ sampleEscalationTwiml() }}</code></pre>
        </div>
      </div>
    </div>
  `,
})
export class ArchitectureComponent {
  readonly careState = inject(CareStateService);

  readonly sampleCaregiverTwiml = computed(() => {
    const cfg = this.careState.config();
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="10"
          action="/twiml/caregiver-gather?taskId=2026-10-24_morning_routine">
    <Play>/twiml/audio?taskId=2026-10-24_morning_routine&amp;type=caregiver</Play>
  </Gather>
  <!-- If ${cfg.caregiverTitle} doesn't press 1, 2, or 3, trigger retry/escalation -->
  <Redirect method="POST">/twiml/no-input?taskId=2026-10-24_morning_routine</Redirect>
</Response>`;
  });

  readonly sampleEscalationTwiml = computed(() => {
    const cfg = this.careState.config();
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- When ${cfg.escalationName} presses 9 on the Escalation Call: -->
<Response>
  <Play>/twiml/audio?taskId=2026-10-24_morning_routine&amp;type=escalation_bridge</Play>
  <Dial callerId="+10000000000" timeout="30">
    ${cfg.caregiverPhone || '+923000000000'}
  </Dial>
</Response>`;
  });
}
