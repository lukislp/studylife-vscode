// Guards against an async state fetch overwriting a newer one that raced past it.
//
// extension.ts's periodic poll (refresh(), fired every studylife.pollSeconds) and its
// command-triggered writes (controlTimer(), fired on Start/Pause/Stop) both end up writing the
// same module-level `lastTimerState`. Network timing gives no guarantee that whichever call
// started first also resolves first - a poll begun just before the user presses Pause can
// resolve just after the pause's own save completes, and paint the still-running state right
// back over the freshly paused one. That is exactly the reported bug: the countdown looks like
// it keeps going after Pause, and a later Resume computes its remaining time from that
// clobbered, still-running snapshot - which has kept ticking down for real in the meantime -
// coming up short by however long the two attempts overlapped.
//
// The fix is not to serialize the requests (the poll must not block on the user's click, and
// vice versa) but to make sure only the most recently *started* attempt is ever allowed to
// apply its result. Whichever attempt is issued last always wins, regardless of resolution
// order; anything that finishes after being superseded is silently dropped rather than rendered.
export class LatestWins {
  private issued = 0;

  /** Reserves a ticket for a new attempt. Call this synchronously, before starting the async
   *  work it will guard - the ordering between callers is what makes "most recent" meaningful. */
  start(): number {
    return ++this.issued;
  }

  /** True when `ticket` is still the most recently issued one, i.e. this attempt's result may
   *  be applied. False means a newer attempt has since started, and this result must be
   *  discarded - it started stale and stayed stale, even if it happens to resolve last. */
  isCurrent(ticket: number): boolean {
    return ticket === this.issued;
  }
}
