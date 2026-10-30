/** What the board shows for a session. */
export type Status = "working" | "needs-you" | "unseen" | "idle";

/**
 * Turns session events into a status. Pure, so the reporter feeds it events and the tests can too.
 *
 * - working: a run is active.
 * - needs you: a blocking dialog opened during the run, or the run failed (until your next input).
 * - unseen: the run finished while the terminal was unfocused (until you focus it or type).
 * - idle: everything else.
 */
export class StatusTracker {
    private running = false;
    private dialog: string | undefined;
    private pendingFailure: string | undefined;
    private failure: string | undefined;
    private unseen = false;
    private focused = true;
    private changedAt = Date.now();
    private last: Status;

    constructor(running = false) {
        this.running = running;
        this.last = this.status;
    }

    get status(): Status {
        if (this.dialog) return "needs-you";
        if (this.running) return "working";
        if (this.failure) return "needs-you";
        if (this.unseen) return "unseen";
        return "idle";
    }

    /** Why the session needs you: the dialog's title, or the run's error. */
    get detail(): string | undefined {
        if (this.dialog) return this.dialog;
        if (!this.running && this.failure) return `failed: ${this.failure}`;
        return undefined;
    }

    /** When the status last changed, in ms since the epoch. */
    get since(): number {
        return this.changedAt;
    }

    get isRunning(): boolean {
        return this.running;
    }

    runStarted(): void {
        this.running = true;
        this.pendingFailure = undefined;
        this.failure = undefined;
        this.unseen = false;
        this.touch();
    }

    /** One low-level run ended; retries and queued work may follow before the run settles. */
    runEnded(error: string | undefined): void {
        this.pendingFailure = error;
    }

    runSettled(aborted: boolean): void {
        this.running = false;
        this.dialog = undefined;
        if (!aborted && this.pendingFailure) this.failure = this.pendingFailure;
        else if (!aborted && !this.focused) this.unseen = true;
        this.pendingFailure = undefined;
        this.touch();
    }

    /** A blocking dialog opened. Only dialogs during a run count: one opened while idle came from you. */
    dialogOpened(title: string): void {
        if (!this.running) return;
        this.dialog = title;
        this.touch();
    }

    dialogClosed(): void {
        this.dialog = undefined;
        this.touch();
    }

    /** You submitted input: you have seen the session and dealt with any failure. */
    input(): void {
        this.unseen = false;
        this.failure = undefined;
        this.touch();
    }

    focusIn(): void {
        this.focused = true;
        this.unseen = false;
        this.touch();
    }

    focusOut(): void {
        this.focused = false;
    }

    private touch(): void {
        const status = this.status;
        if (status === this.last) return;
        this.last = status;
        this.changedAt = Date.now();
    }
}
