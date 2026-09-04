/**
 * One-time “do this next” checklist after free trial unlocks the main app.
 * Does not re-ask onboarding mode — only guides next actions.
 */
import { getKeyValueStore } from '../platform/storage';
import { OnboardingIntentMode } from './onboarding';

const DISMISSED_KEY = 'predict.post_trial_next_steps.dismissed.v1';

export type PostTrialStepId = 'add_kalshi' | 'start_poller' | 'enable_autotrade';

export type PostTrialStep = {
  id: PostTrialStepId;
  title: string;
  detail: string;
  done: boolean;
};

export type PostTrialNextStepsPlan = {
  intent: OnboardingIntentMode;
  headline: string;
  subhead: string;
  steps: PostTrialStep[];
  allDone: boolean;
};

export async function isPostTrialNextStepsDismissed(): Promise<boolean> {
  try {
    return (await getKeyValueStore().getItem(DISMISSED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markPostTrialNextStepsDismissed(): Promise<void> {
  await getKeyValueStore().setItem(DISMISSED_KEY, '1');
}

/** Pure builder — unit-test friendly. */
export function buildPostTrialNextStepsPlan(input: {
  intent: OnboardingIntentMode;
  hasCredentials: boolean;
  pollerRunning: boolean;
  autoTradeEnabled: boolean;
}): PostTrialNextStepsPlan {
  const { intent, hasCredentials, pollerRunning, autoTradeEnabled } = input;
  const wantsAuto = intent === 'alerts_and_autotrade';

  const steps: PostTrialStep[] = [];

  if (wantsAuto) {
    steps.push({
      id: 'add_kalshi',
      title: hasCredentials ? 'Kalshi connected' : 'Add Kalshi credentials',
      detail: hasCredentials
        ? 'API key is saved on this phone.'
        : 'Required before Auto-trade can place orders.',
      done: hasCredentials,
    });
  }

  steps.push({
    id: 'start_poller',
    title: pollerRunning ? 'Poller running' : 'Start the poller',
    detail: pollerRunning
      ? 'Lean signals will refresh on this screen.'
      : 'Turns on lean signal checks while the app stays open.',
    done: pollerRunning,
  });

  if (wantsAuto) {
    steps.push({
      id: 'enable_autotrade',
      title: autoTradeEnabled ? 'Auto-trade on' : 'Enable Auto-trade',
      detail: autoTradeEnabled
        ? 'Live orders allowed when cushions and risk gates pass.'
        : 'In Settings — Face ID confirms; keep the app open while trading.',
      done: autoTradeEnabled,
    });
  }

  const allDone = steps.every((s) => s.done);

  return {
    intent,
    headline: wantsAuto ? 'Next: alerts + Auto-trade' : 'Next: lean alerts',
    subhead: wantsAuto
      ? 'You chose alerts with Auto-trade later. Finish these steps when you are ready.'
      : hasCredentials
        ? 'You chose alerts only. Start the poller to see lean signals.'
        : 'You chose alerts only. Start the poller for lean signals — add Kalshi later in Settings if you want balances.',
    steps,
    allDone,
  };
}

export function shouldShowPostTrialNextSteps(input: {
  dismissed: boolean;
  intent: OnboardingIntentMode | null;
  plan: PostTrialNextStepsPlan | null;
}): boolean {
  if (input.dismissed) return false;
  if (!input.intent) return false; // legacy / skipped mode — do not nag
  if (!input.plan) return false;
  if (input.plan.allDone) return false;
  return true;
}
