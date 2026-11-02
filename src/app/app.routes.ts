import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'kiosk',
    loadComponent: () =>
      import('./features/kiosk/caregiver-kiosk.component').then(
        (m) => m.CaregiverKioskComponent
      ),
  },
  {
    path: 'schedule',
    loadComponent: () =>
      import('./features/schedule-builder/schedule-builder.component').then(
        (m) => m.ScheduleBuilderComponent
      ),
  },
  {
    path: 'architecture',
    loadComponent: () =>
      import('./features/architecture/architecture.component').then(
        (m) => m.ArchitectureComponent
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
