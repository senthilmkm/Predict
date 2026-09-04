import {
  buildPostTrialNextStepsPlan,
  markPostTrialNextStepsDismissed,
  isPostTrialNextStepsDismissed,
  shouldShowPostTrialNextSteps,
} from '../src/storage/postTrialNextSteps';
import { MemoryKeyValueStore, setKeyValueStore } from '../src/platform/storage';

describe('post-trial next steps', () => {
  beforeEach(() => {
    setKeyValueStore(new MemoryKeyValueStore());
  });

  test('alerts_only plan is poller-focused', () => {
    const plan = buildPostTrialNextStepsPlan({
      intent: 'alerts_only',
      hasCredentials: false,
      pollerRunning: false,
      autoTradeEnabled: false,
    });
    expect(plan.steps.map((s) => s.id)).toEqual(['start_poller']);
    expect(plan.allDone).toBe(false);
    expect(plan.subhead).toMatch(/Kalshi later/i);

    const done = buildPostTrialNextStepsPlan({
      intent: 'alerts_only',
      hasCredentials: true,
      pollerRunning: true,
      autoTradeEnabled: false,
    });
    expect(done.allDone).toBe(true);
  });

  test('alerts_and_autotrade lists kalshi → poller → autotrade', () => {
    const plan = buildPostTrialNextStepsPlan({
      intent: 'alerts_and_autotrade',
      hasCredentials: false,
      pollerRunning: false,
      autoTradeEnabled: false,
    });
    expect(plan.steps.map((s) => s.id)).toEqual([
      'add_kalshi',
      'start_poller',
      'enable_autotrade',
    ]);
    expect(plan.allDone).toBe(false);

    const mid = buildPostTrialNextStepsPlan({
      intent: 'alerts_and_autotrade',
      hasCredentials: true,
      pollerRunning: true,
      autoTradeEnabled: false,
    });
    expect(mid.steps.find((s) => s.id === 'add_kalshi')?.done).toBe(true);
    expect(mid.steps.find((s) => s.id === 'enable_autotrade')?.done).toBe(false);
    expect(mid.allDone).toBe(false);
  });

  test('shouldShow skips legacy (no intent) and dismissed', () => {
    const plan = buildPostTrialNextStepsPlan({
      intent: 'alerts_only',
      hasCredentials: true,
      pollerRunning: false,
      autoTradeEnabled: false,
    });
    expect(
      shouldShowPostTrialNextSteps({ dismissed: false, intent: null, plan })
    ).toBe(false);
    expect(
      shouldShowPostTrialNextSteps({ dismissed: true, intent: 'alerts_only', plan })
    ).toBe(false);
    expect(
      shouldShowPostTrialNextSteps({ dismissed: false, intent: 'alerts_only', plan })
    ).toBe(true);
  });

  test('dismiss flag persists', async () => {
    expect(await isPostTrialNextStepsDismissed()).toBe(false);
    await markPostTrialNextStepsDismissed();
    expect(await isPostTrialNextStepsDismissed()).toBe(true);
  });
});
