import { Component, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { AcousticService } from '../acoustic.service';
import { errorMessage } from '../behaviour-core';

/** The Notification tab: the OS notification permission and a button to ask for it. */
@Component({
  selector: 'app-notification-tab',
  template: `
    <section class="card">
      <h2 class="card-title">Notification Authorization</h2>
      <div class="auth-row">
        <span class="auth-dot" [class.authorized]="authorized()"></span>
        <span class="auth-status-text">Status: {{ authorized() ? 'Authorized' : 'Not Authorized' }}</span>
      </div>
      <button class="action" id="btn_enable_push" [disabled]="!acoustic.sdkEnabled()" (click)="enablePush()">Enable Push</button>
      @if (message()) {
        <p class="auth-message" [class.error]="isError()" [class.success]="!isError()">{{ message() }}</p>
      }
    </section>
  `
})
export class NotificationTab implements OnInit, OnDestroy {
  readonly acoustic = inject(AcousticService);
  readonly authorized = signal(false);
  readonly message = signal('');
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.refresh();
  };

  constructor() {
    // read the permission state once the SDK is up
    effect(() => {
      if (this.acoustic.sdkEnabled()) this.refresh();
      if (this.acoustic.sdkNotStarted()) this.set(false, 'Error: SDK not started — set appKey and postMessageUrl in capacitor.config.json');
    });
  }

  ngOnInit(): void {
    // re-check every time the app comes back to the foreground, so the badge stays accurate after the system dialog
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  isError(): boolean {
    const m = this.message();
    return m.startsWith('Error') || m.includes('disabled') || m.includes('denied');
  }

  enablePush(): void {
    this.acoustic.pushRequestPermission().then(
      (result) => {
        const granted = Boolean(result && result.granted);
        this.set(granted, granted ? 'Push notifications are enabled' : 'Push notifications permission denied');
      },
      (error) => this.set(false, 'Error: ' + errorMessage(error))
    );
  }

  private refresh(): void {
    // null = not determined: the badge stays at the default "Not Authorized"
    this.acoustic.pushPermissionState().then((state) => {
      if (state === true) this.set(true, 'Push notifications are enabled');
      else if (state === false) this.set(false, 'Push notifications permission denied');
    }).catch(() => undefined);
  }

  private set(authorized: boolean, message: string): void {
    this.authorized.set(authorized);
    this.message.set(message);
  }
}
