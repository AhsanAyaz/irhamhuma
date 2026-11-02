import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { CareStateService } from './core/services/care-state.service';
import {
  CareConfigSchema,
  ParsedScheduleResponseSchema,
} from './core/models/care.models';

describe('Irhamhuma Family Care & Routine Reminder System', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app and render Irhamhuma header with configurable family personas', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Irhamhuma');
    expect(compiled.textContent).toContain('Patient');
    expect(compiled.textContent).toContain('Caregiver');
  });

  it('should unlock chained AFTER_TASK items (+15m Post-Breakfast Routine) when Breakfast is completed via Press 1', () => {
    const careState = TestBed.inject(CareStateService);
    careState.resetTodayProgress();

    const initialTasks = careState.sortedTasks();
    const breakfast = initialTasks.find((t) => t.templateId === 'breakfast')!;
    const morningRoutineBefore = initialTasks.find((t) => t.templateId === 'morning_routine')!;

    expect(breakfast.status).toBe('SCHEDULED');
    expect(morningRoutineBefore.status).toBe('WAITING_FOR_PARENT');

    careState.initiateCaregiverCall(breakfast.id);
    careState.handleCaregiverDigit(breakfast.id, '1');

    const updatedTasks = careState.sortedTasks();
    const breakfastAfter = updatedTasks.find((t) => t.templateId === 'breakfast')!;
    const morningRoutineAfter = updatedTasks.find((t) => t.templateId === 'morning_routine')!;

    expect(breakfastAfter.status).toBe('COMPLETED');
    expect(morningRoutineAfter.status).toBe('SCHEDULED');
  });

  it('should escalate immediately when Caregiver presses 3 (Patient refusing) and bridge call on Press 9', () => {
    const careState = TestBed.inject(CareStateService);
    careState.resetTodayProgress();

    const breakfast = careState.sortedTasks().find((t) => t.templateId === 'breakfast')!;
    careState.initiateCaregiverCall(breakfast.id);

    careState.handleCaregiverDigit(breakfast.id, '3');

    const escalatedTask = careState.sortedTasks().find((t) => t.id === breakfast.id)!;
    expect(escalatedTask.status).toBe('ESCALATED');
    expect(escalatedTask.escalationReason).toBe('PATIENT_REFUSING');
    expect(careState.activeCall()?.mode).toBe('ESCALATION');

    careState.handleEscalationDigit(breakfast.id, '9');
    const bridgedTask = careState.sortedTasks().find((t) => t.id === breakfast.id)!;
    expect(bridgedTask.status).toBe('BRIDGED');
    expect(careState.activeCall()?.mode).toBe('BRIDGED');
  });

  it('should retry Caregiver on Attempt #1 No-Answer and escalate on Attempt #2 No-Answer', () => {
    const careState = TestBed.inject(CareStateService);
    careState.resetTodayProgress();

    const lunch = careState.sortedTasks().find((t) => t.templateId === 'lunch')!;
    careState.initiateCaregiverCall(lunch.id);
    expect(careState.activeCall()?.attemptNumber).toBe(1);

    // Attempt 1 No Answer -> Automatically triggers Attempt 2
    careState.handleCaregiverNoAnswer(lunch.id);
    expect(careState.activeCall()?.attemptNumber).toBe(2);

    // Attempt 2 No Answer -> Escalates
    careState.handleCaregiverNoAnswer(lunch.id);
    const taskAfter2Misses = careState.sortedTasks().find((t) => t.id === lunch.id)!;
    expect(taskAfter2Misses.status).toBe('ESCALATED');
    expect(taskAfter2Misses.escalationReason).toBe('NO_ANSWER');
    expect(careState.activeCall()?.mode).toBe('ESCALATION');
  });

  it('should validate Gemini structured output with Zod schema', () => {
    const sampleGeminiOutput = {
      summary: 'Daily routine schedule',
      items: [
        {
          id: 'breakfast',
          title: 'Breakfast',
          category: 'MEAL',
          triggerType: 'FIXED_TIME',
          fixedTime: '08:30',
          parentTemplateId: null,
          offsetMinutes: null,
          instructions: 'Porridge and warm water',
          urduScript: 'Assalam-o-Alaikum...',
          urduScriptNative: 'السلام علیکم...',
          escalationScript: 'Assalam-o-Alaikum...',
          order: 1,
          active: true,
        },
      ],
    };

    const parsed = ParsedScheduleResponseSchema.parse(sampleGeminiOutput);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].id).toBe('breakfast');

    const configParsed = CareConfigSchema.parse({});
    expect(configParsed.patientTitle).toBe('Patient');
    expect(configParsed.caregiverTitle).toBe('Caregiver');
  });
});
