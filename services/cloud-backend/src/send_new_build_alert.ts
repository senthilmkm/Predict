import { sendPushNotification } from './services/notifications';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const validExpoToken = 'ExponentPushToken[HrXfGvHNjfMvsDpWUr_yHJ]';

  await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').update({
    pushTokens: [validExpoToken],
    fcmTokens: [validExpoToken],
  });

  const timestamp = new Date().toLocaleTimeString();
  const title = `🚀 INSTANT GCP ALERT [${timestamp}]`;
  const body = `Background App Refresh Verified · Gold Gap $8.50 · Cushion $7 · Time ${timestamp}`;

  console.log(`Sending instant GCP alert to token: ${validExpoToken}`);

  const res = await sendPushNotification([validExpoToken], title, body, {
    asset: 'Gold',
    ticker: 'KXGLDUSD-26SEP05-T130000',
    type: 'lean_signal',
    source: 'gcp',
  });

  console.log('Push Result:', res);
}

main().catch(console.error);
