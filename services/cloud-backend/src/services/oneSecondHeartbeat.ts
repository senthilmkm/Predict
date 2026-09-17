import { runAlwaysOnOneSecondBeat } from '../routes/worker';

let started = false;

/** One in-process 1s loop: lean live_data + WS ask/bid. Never overlaps itself. */
export function startAlwaysOnOneSecondLoop(): void {
  if (started || process.env.NODE_ENV === 'test') return;
  started = true;
  const beat = async () => {
    const startedAt = Date.now();
    try {
      await runAlwaysOnOneSecondBeat();
    } catch {
      /* next beat */
    }
    setTimeout(beat, Math.max(0, 1000 - (Date.now() - startedAt)));
  };
  void beat();
}
