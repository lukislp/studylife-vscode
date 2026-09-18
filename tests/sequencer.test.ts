import { describe, expect, it } from "vitest";
import { LatestWins } from "../src/sequencer.js";

describe("LatestWins", () => {
  it("lets a lone attempt commit", () => {
    const seq = new LatestWins();
    const ticket = seq.start();
    expect(seq.isCurrent(ticket)).toBe(true);
  });

  it("only the most recently started ticket is current", () => {
    const seq = new LatestWins();
    const first = seq.start();
    const second = seq.start();
    expect(seq.isCurrent(first)).toBe(false);
    expect(seq.isCurrent(second)).toBe(true);
  });

  it("reproduces the poll-vs-pause race: a stale attempt started before a newer one must be discarded even if it resolves after it", () => {
    const seq = new LatestWins();
    // The periodic poll fires first...
    const pollTicket = seq.start();
    // ...but the user clicks Pause before that poll's network call resolves.
    const pauseTicket = seq.start();
    // The poll's response finally comes back - it must not be treated as current, regardless of
    // arriving after the pause ticket was issued.
    expect(seq.isCurrent(pollTicket)).toBe(false);
    // The pause's own result is still the one that should be rendered.
    expect(seq.isCurrent(pauseTicket)).toBe(true);
  });

  it("keeps discarding a stale ticket even once a third attempt has started", () => {
    const seq = new LatestWins();
    const a = seq.start();
    const b = seq.start();
    const c = seq.start();
    expect(seq.isCurrent(a)).toBe(false);
    expect(seq.isCurrent(b)).toBe(false);
    expect(seq.isCurrent(c)).toBe(true);
  });
});

// The two tests below model the actual shape of the bug in extension.ts: refresh() (the
// periodic poll) and controlTimer() (the Pause button) both write the same variable
// (lastTimerState) from whatever their own network call resolves with, with nothing to say
// which one is more recent than the other. A slow poll started just before the user clicks
// Pause, and resolving just after, would otherwise overwrite the freshly paused state with the
// stale running one it already had in hand - which is exactly the reported symptom: the panel
// looks like it is still counting down right after Pause, and a later Resume computes its
// remaining time from that clobbered, still-running snapshot instead of the frozen one.
describe("the race this guards against, reproduced with real async timing", () => {
  it("without a ticket guard, a poll issued before a pause but resolving after it clobbers the correct paused state", async () => {
    let lastState = "initial-running";

    // The periodic poll starts first, but its network call is slower...
    const pollResolves = new Promise<string>((resolve) =>
      setTimeout(() => resolve("poll-result:running"), 20),
    );
    // ...the user's Pause click starts second, and its save resolves first.
    const pauseResolves = new Promise<string>((resolve) =>
      setTimeout(() => resolve("pause-result:paused"), 5),
    );

    // Naive extension.ts behaviour today: whichever promise settles LAST simply overwrites
    // lastState, with no notion of which attempt was issued more recently.
    void pauseResolves.then((r) => {
      lastState = r;
    });
    void pollResolves.then((r) => {
      lastState = r;
    });

    await pauseResolves;
    expect(lastState).toBe("pause-result:paused"); // correct so far - Paused is on screen...

    await pollResolves;
    // ...but the stale poll answer, still in flight when Pause was clicked, wins anyway. This
    // is the bug: the display flips back to a running snapshot right after the user paused.
    expect(lastState).toBe("poll-result:running");
  });

  it("with the LatestWins guard, the more recently issued attempt always wins regardless of resolution order", async () => {
    const seq = new LatestWins();
    let lastState = "initial-running";

    const pollTicket = seq.start();
    const pollResolves = new Promise<string>((resolve) =>
      setTimeout(() => resolve("poll-result:running"), 20),
    );
    const pauseTicket = seq.start();
    const pauseResolves = new Promise<string>((resolve) =>
      setTimeout(() => resolve("pause-result:paused"), 5),
    );

    void pauseResolves.then((r) => {
      if (seq.isCurrent(pauseTicket)) lastState = r;
    });
    void pollResolves.then((r) => {
      if (seq.isCurrent(pollTicket)) lastState = r;
    });

    await pauseResolves;
    expect(lastState).toBe("pause-result:paused");

    await pollResolves;
    // The stale poll answer is dropped - the ticket issued before Pause is no longer current -
    // so the display stays correctly on "Paused" instead of flipping back to running.
    expect(lastState).toBe("pause-result:paused");
  });
});
