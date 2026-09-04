/** Shared Kalshi API key / PEM instructions (Settings ⓘ + Onboarding step 5). */

export type KalshiHelpStep = {
  n: number;
  title: string;
  body: string;
};

export const KALSHI_API_KEY_HELP_LEAD =
  'You need a Kalshi account first. Without an account you cannot create an API key.';

export const KALSHI_API_KEY_HELP_STEPS: KalshiHelpStep[] = [
  {
    n: 1,
    title: 'Create a Kalshi account (required)',
    body: 'Open kalshi.com (or the Kalshi app), sign up, and finish account setup. You must be logged in before the next steps.',
  },
  {
    n: 2,
    title: 'Open account profile',
    body: 'On the website, click your profile / account icon (usually top-right). Open Account Settings or Profile.',
  },
  {
    n: 3,
    title: 'Find API Keys',
    body: 'Scroll to the API Keys section. Or go to:\nkalshi.com/account/profile',
  },
  {
    n: 4,
    title: 'Create a new API key',
    body: 'Tap Create New API Key (or Generate API Key). Kalshi will make a new key for you.',
  },
  {
    n: 5,
    title: 'Copy the Key ID',
    body: 'You will see a Key ID (a long ID string). Copy it. Paste it into this app’s “API Key ID” field.',
  },
  {
    n: 6,
    title: 'Save the private key (PEM) right away',
    body:
      'Kalshi also shows a private key that looks like:\n' +
      '-----BEGIN RSA PRIVATE KEY-----\n' +
      '…\n' +
      '-----END RSA PRIVATE KEY-----\n\n' +
      'Copy all of it, or download the .txt / .pem file. You usually cannot see this private key again later — save it now.',
  },
  {
    n: 7,
    title: 'Add it in Predict',
    body: 'Paste the Key ID → paste or Import the PEM file → Save to Secure Store → tap Test connection (in Settings, or here during setup).',
  },
];

export const KALSHI_API_KEY_HELP_TIP =
  'Tip: Keep the private key private. Do not share it or post it anywhere. If you lose it, create a new API key in Kalshi and update this app.';
