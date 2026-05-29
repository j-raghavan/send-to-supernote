import type { Notification, Notifier, OptionsOpener } from '@shared/ports';

/** Records every notification for assertions. */
export class FakeNotifier implements Notifier {
  readonly notifications: Notification[] = [];

  notify(notification: Notification): Promise<void> {
    this.notifications.push(notification);
    return Promise.resolve();
  }
}

/** Records every request to open Options (with any prefilled account). */
export class FakeOptionsOpener implements OptionsOpener {
  readonly opens: Array<string | undefined> = [];

  open(prefillAccount?: string): Promise<void> {
    this.opens.push(prefillAccount);
    return Promise.resolve();
  }
}
