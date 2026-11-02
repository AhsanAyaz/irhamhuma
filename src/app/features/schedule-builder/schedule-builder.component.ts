import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CareStateService } from '../../core/services/care-state.service';
import { GeminiAiService } from '../../core/services/gemini-ai.service';
import {
  ParsedScheduleResponse,
  ScheduleTemplate,
  ScheduleTemplateItemSchema,
  TaskCategory,
  TriggerType,
} from '../../core/models/care.models';

@Component({
  selector: 'app-schedule-builder',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-8">
      <!-- Section 1: AI Schedule & Prescription Parser (Gemini 2.5 Flash + Zod Structured Output) -->
      <section class="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-950 via-slate-900 to-emerald-950 p-6 text-white shadow-xl sm:p-8">
        <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div class="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-semibold text-indigo-300">
              <span>✨</span> Powered by <code>&#64;google/genai</code> (gemini-2.5-flash) + <code>Zod</code> Structured Outputs
            </div>
            <h1 class="mt-2 text-2xl font-bold">
              AI Natural Language &amp; Prescription Schedule Builder
            </h1>
            <p class="mt-1 max-w-3xl text-sm text-slate-300">
              Write {{ careState.config().patientTitle }}'s daily routine in plain English/Roman Urdu or upload a photo of the hospital discharge summary. Gemini extracts fixed times, meal-relative chains (e.g., <em>+15m after breakfast</em>, <em>+2h boiled eggs</em>), and generates warm Urdu voice prompts for {{ careState.config().caregiverTitle }}.
            </p>
          </div>
        </div>

        <div class="mt-6 space-y-4">
          <div>
            <label for="nl-prompt" class="block text-xs font-semibold tracking-wider text-indigo-200 uppercase">
              Describe {{ careState.config().patientTitle }}'s Daily Routine &amp; Medications:
            </label>
            <textarea
              id="nl-prompt"
              rows="3"
              [value]="naturalPrompt()"
              (input)="onPromptInput($event)"
              class="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 p-4 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
              placeholder="e.g., Breakfast at 8:30 AM, then morning medicines 15 minutes later, then 2 boiled eggs 2 hours after breakfast..."
            ></textarea>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex flex-wrap items-center gap-3">
              <label
                class="cursor-pointer inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                <span>📄 Upload Discharge Prescription Photo (Optional)</span>
                <input
                  type="file"
                  accept="image/*"
                  (change)="onImageSelected($event)"
                  class="hidden"
                />
              </label>

              @if (uploadedImageName(); as imgName) {
                <span class="inline-flex items-center gap-2 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-300">
                  📎 {{ imgName }}
                  <button type="button" (click)="clearImage()" class="text-white hover:text-rose-300">✕</button>
                </span>
              }
            </div>

            <button
              type="button"
              (click)="runGeminiParser()"
              [disabled]="geminiService.isGenerating()"
              class="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              @if (geminiService.isGenerating()) {
                <span>⏳ Extracting Structured Schedule with Gemini + Zod...</span>
              } @else {
                <span>✨ Extract &amp; Generate Urdu Voice Schedule</span>
              }
            </button>
          </div>

          @if (geminiService.lastError(); as err) {
            <div class="rounded-xl border border-rose-400/40 bg-rose-950/60 p-3 text-xs text-rose-200">
              ⚠️ {{ err }}
            </div>
          }

          <!-- Preview of Zod-Validated Gemini Response -->
          @if (parsedPreview(); as preview) {
            <div class="mt-4 rounded-2xl border border-emerald-400/40 bg-slate-900/90 p-5 space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span class="text-xs font-bold tracking-wider text-emerald-400 uppercase">
                    ✓ Zod Schema Validated Output ({{ preview.items.length }} Linked Tasks)
                  </span>
                  <p class="mt-1 text-xs text-slate-300">{{ preview.summary }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    (click)="applyParsedSchedule()"
                    class="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                  >
                    ✓ Apply Schedule to Today's Timeline
                  </button>
                  <button
                    type="button"
                    (click)="parsedPreview.set(null)"
                    class="rounded-xl bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
                  >
                    Dismiss
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                @for (item of preview.items; track item.id) {
                  <div class="rounded-xl border border-slate-700 bg-slate-800/80 p-3 text-xs space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="font-bold text-white">#{{ item.order }} {{ item.title }}</span>
                      <span class="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                        {{ item.category }}
                      </span>
                    </div>
                    <p class="text-[11px] text-emerald-300">
                      @if (item.triggerType === 'FIXED_TIME') {
                        🕒 Fixed Time: {{ item.fixedTime }}
                      } @else {
                        🔗 +{{ item.offsetMinutes }}m after "{{ item.parentTemplateId }}"
                      }
                    </p>
                    <p class="text-[11px] text-slate-400 line-clamp-2">{{ item.urduScript }}</p>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      </section>

      <!-- Section 2: Current Schedule Templates & Reactive Form Editor -->
      <div class="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <!-- Left 2 Cols: Existing Schedule Templates -->
        <div class="space-y-4 lg:col-span-2">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-bold text-slate-900">
                Active Daily Schedule Templates ({{ careState.templates().length }} Items)
              </h2>
              <p class="text-xs text-slate-500">
                Click any item to edit its timing, parent task dependency, or Urdu voice prompt.
              </p>
            </div>
            <button
              type="button"
              (click)="startNewTask()"
              class="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              + Add Task Item
            </button>
          </div>

          <div class="space-y-3">
            @for (tpl of careState.templates(); track tpl.id) {
              <div
                class="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:border-emerald-300"
              >
                <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-xs font-bold text-slate-400">#{{ tpl.order }}</span>
                      <h3 class="text-sm font-bold text-slate-900">{{ tpl.title }}</h3>
                      <span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                        {{ tpl.category }}
                      </span>
                      @if (tpl.triggerType === 'FIXED_TIME') {
                        <span class="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                          🕒 {{ tpl.fixedTime }}
                        </span>
                      } @else {
                        <span class="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                          🔗 +{{ tpl.offsetMinutes }}m after {{ tpl.parentTemplateId }}
                        </span>
                      }
                    </div>
                    <p class="text-xs text-slate-600">{{ tpl.instructions }}</p>
                    <p class="text-xs italic text-slate-500 pt-1">"{{ tpl.urduScript }}"</p>
                  </div>

                  <div class="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      (click)="playNativeUrduPreview(tpl.id, tpl.urduScriptNative || tpl.urduScript)"
                      class="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      🔊 Test Urdu Voice
                    </button>
                    <button
                      type="button"
                      (click)="editTemplate(tpl)"
                      class="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      (click)="careState.deleteTemplate(tpl.id)"
                      class="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Right Col: Reactive Form to Add / Edit Schedule Item -->
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs h-fit">
          <h3 class="text-base font-bold text-slate-900">
            {{ isEditingExisting() ? 'Edit Schedule Task' : 'Add New Schedule Task' }}
          </h3>
          <p class="mt-0.5 text-xs text-slate-500">
            Configure fixed clock time or link relative to a meal.
          </p>

          <form [formGroup]="taskForm" (ngSubmit)="saveTaskForm()" class="mt-4 space-y-3.5 text-xs">
            <div>
              <label for="task-id" class="block font-semibold text-slate-700">Task ID (snake_case)</label>
              <input
                id="task-id"
                type="text"
                formControlName="id"
                class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                placeholder="e.g., evening_milkshake"
              />
            </div>

            <div>
              <label for="task-title" class="block font-semibold text-slate-700">Title</label>
              <input
                id="task-title"
                type="text"
                formControlName="title"
                class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                placeholder="e.g., Boiled Eggs (2h After Breakfast)"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="task-category" class="block font-semibold text-slate-700">Category</label>
                <select
                  id="task-category"
                  formControlName="category"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="MEAL">🍲 MEAL</option>
                  <option value="MEDICATION">💊 MEDICATION</option>
                  <option value="SNACK">🥚 SNACK</option>
                  <option value="HYDRATION">🥛 HYDRATION</option>
                </select>
              </div>

              <div>
                <label for="task-trigger" class="block font-semibold text-slate-700">Trigger Mode</label>
                <select
                  id="task-trigger"
                  formControlName="triggerType"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="FIXED_TIME">🕒 Fixed Clock Time</option>
                  <option value="AFTER_TASK">🔗 After Another Task</option>
                </select>
              </div>
            </div>

            @if (taskForm.controls.triggerType.value === 'FIXED_TIME') {
              <div>
                <label for="task-fixed-time" class="block font-semibold text-slate-700">Fixed Time (24h HH:mm)</label>
                <input
                  id="task-fixed-time"
                  type="time"
                  formControlName="fixedTime"
                  class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            } @else {
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="task-parent" class="block font-semibold text-slate-700">Parent Task</label>
                  <select
                    id="task-parent"
                    formControlName="parentTemplateId"
                    class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  >
                    @for (p of careState.templates(); track p.id) {
                      <option [value]="p.id">{{ p.title }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label for="task-offset" class="block font-semibold text-slate-700">Offset (Minutes)</label>
                  <input
                    id="task-offset"
                    type="number"
                    formControlName="offsetMinutes"
                    class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            }

            <div>
              <label for="task-instructions" class="block font-semibold text-slate-700">Caregiver Instructions</label>
              <textarea
                id="task-instructions"
                rows="2"
                formControlName="instructions"
                class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
              ></textarea>
            </div>

            <div>
              <label for="task-urdu" class="block font-semibold text-slate-700">
                Spoken Urdu Voice Prompt (for {{ careState.config().caregiverTitle }})
              </label>
              <textarea
                id="task-urdu"
                rows="3"
                formControlName="urduScript"
                class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
              ></textarea>
            </div>

            <div class="pt-2 flex items-center gap-2">
              <button
                type="submit"
                class="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-2xs hover:bg-emerald-500"
              >
                💾 Save Schedule Item
              </button>
              <button
                type="button"
                (click)="playNativeUrduPreview(taskForm.controls.id.value, taskForm.controls.urduScriptNative.value || taskForm.controls.urduScript.value)"
                class="rounded-xl border border-slate-300 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-100"
              >
                🔊 Preview Urdu
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
})
export class ScheduleBuilderComponent {
  readonly careState = inject(CareStateService);
  readonly geminiService = inject(GeminiAiService);
  private readonly fb = inject(FormBuilder);

  readonly naturalPrompt = signal(
    'Breakfast at 8:30 AM, then morning medicines 15 minutes after breakfast, then 2 boiled eggs 2 hours after breakfast. Lunch at 1:30 PM, then afternoon medicines 15 minutes after lunch. Evening tea + cake rusks at 5:00 PM. Evening energy milkshake at 6:30 PM. Dinner at 8:30 PM, and mandatory night medicines 15 minutes after dinner.'
  );
  readonly uploadedImageName = signal<string | null>(null);
  readonly uploadedImageBase64 = signal<{ data: string; mimeType: string } | null>(null);
  readonly parsedPreview = signal<ParsedScheduleResponse | null>(null);
  readonly isEditingExisting = signal(false);

  readonly taskForm = this.fb.nonNullable.group({
    id: ['custom_task', [Validators.required]],
    title: ['New Care Task', [Validators.required]],
    category: ['MEDICATION' as TaskCategory, [Validators.required]],
    triggerType: ['FIXED_TIME' as TriggerType, [Validators.required]],
    fixedTime: ['10:00'],
    parentTemplateId: ['breakfast'],
    offsetMinutes: [15],
    instructions: ['Give with 1 glass of lukewarm water.'],
    urduScript: [
      'Assalam-o-Alaikum! Yaad-dehani ka waqt ho gaya hai. Mukammal hone par jawab mein 1 likh kar bhejein, 15 minute snooze ke liye 2 likh kar bhejein, ya madad ke liye 3 likh kar bhejein.',
      [Validators.required],
    ],
    urduScriptNative: [
      'السلام علیکم! یاد دہانی کا وقت ہو گیا ہے۔ مکمل ہونے پر جواب میں 1 لکھ کر بھیجیں، 15 منٹ بعد کے لیے 2 لکھ کر بھیجیں، یا مدد کے لیے 3 لکھ کر بھیجیں۔',
    ],
    escalationScript: [
      'Assalam-o-Alaikum. Escalation reminder. Press 1 if done, 2 to snooze, or 9 to bridge call.',
    ],
    order: [10],
  });

  private activePreviewAudio: HTMLAudioElement | null = null;

  playNativeUrduPreview(taskId: string, urduNativeText: string): void {
    if (this.activePreviewAudio) {
      this.activePreviewAudio.pause();
      this.activePreviewAudio = null;
    }
    const url = this.careState.getCloudUrduAudioStreamUrl(taskId, urduNativeText);
    this.activePreviewAudio = new Audio(url);
    this.activePreviewAudio.play().catch(() => {});
  }

  onPromptInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.naturalPrompt.set(target.value);
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadedImageName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1] ?? '';
      this.uploadedImageBase64.set({
        data: base64Data,
        mimeType: file.type || 'image/jpeg',
      });
    };
    reader.readAsDataURL(file);
  }

  clearImage(): void {
    this.uploadedImageName.set(null);
    this.uploadedImageBase64.set(null);
  }

  async runGeminiParser(): Promise<void> {
    const result = await this.geminiService.parseScheduleFromInput(
      this.naturalPrompt(),
      this.careState.config(),
      this.uploadedImageBase64() ?? undefined
    );
    this.parsedPreview.set(result);
  }

  applyParsedSchedule(): void {
    const preview = this.parsedPreview();
    if (!preview) return;
    this.careState.replaceScheduleTemplates(preview.items);
    this.parsedPreview.set(null);
  }

  startNewTask(): void {
    this.isEditingExisting.set(false);
    const cfg = this.careState.config();
    this.taskForm.patchValue({
      id: `task_${this.careState.templates().length + 1}`,
      title: '',
      category: 'MEDICATION',
      triggerType: 'FIXED_TIME',
      fixedTime: '11:00',
      parentTemplateId: 'breakfast',
      offsetMinutes: 30,
      instructions: '',
      urduScript: `Assalam-o-Alaikum ${cfg.caregiverTitle}! ${cfg.patientTitle} ke liye yaad-dehoni. Mukammal hone par 1 dabayein, ${cfg.snoozeDurationMinutes} minute snooze ke liye 2 dabayein, ya ${cfg.escalationName} ko call karne ke liye 3 dabayein.`,
      order: this.careState.templates().length + 1,
    });
  }

  editTemplate(tpl: ScheduleTemplate): void {
    this.isEditingExisting.set(true);
    this.taskForm.patchValue({
      id: tpl.id,
      title: tpl.title,
      category: tpl.category,
      triggerType: tpl.triggerType,
      fixedTime: tpl.fixedTime ?? '09:00',
      parentTemplateId: tpl.parentTemplateId ?? 'breakfast',
      offsetMinutes: tpl.offsetMinutes ?? 15,
      instructions: tpl.instructions,
      urduScript: tpl.urduScript,
      urduScriptNative: tpl.urduScriptNative,
      escalationScript: tpl.escalationScript,
      order: tpl.order,
    });
  }

  saveTaskForm(): void {
    const raw = this.taskForm.getRawValue();
    const isFixed = raw.triggerType === 'FIXED_TIME';
    const validated = ScheduleTemplateItemSchema.parse({
      id: raw.id.trim().replace(/\s+/g, '_').toLowerCase(),
      title: raw.title,
      category: raw.category,
      triggerType: raw.triggerType,
      fixedTime: isFixed ? raw.fixedTime : null,
      parentTemplateId: isFixed ? null : raw.parentTemplateId,
      offsetMinutes: isFixed ? null : Number(raw.offsetMinutes),
      instructions: raw.instructions,
      urduScript: raw.urduScript,
      urduScriptNative: raw.urduScriptNative || raw.urduScript,
      escalationScript: raw.escalationScript,
      order: Number(raw.order),
      active: true,
    });

    this.careState.addOrUpdateTemplate(validated);
  }
}
