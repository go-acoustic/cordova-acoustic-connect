import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

// Only a build made for the wire verification contains the scenario (see src/app/e2e.ts).
if (E2E_BUILD) {
  import('./app/e2e').then((m) => m.startE2e());
}
