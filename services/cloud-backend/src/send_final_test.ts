import { sendPushNotification } from './services/notifications';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const validExpoToken = 'ExponentPushToken[HrXfGvHNjfMvsDpWUr_yHJ]';

  // Clean Firestore pushTokens & fcmTokens arrays to contain only the valid Expo push token
  await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').update({
    pushTokens: [validExpoToken],
    fcmTokens: [validExpoToken],
  });

  const timestamp = new Date().toLocaleTimeString();
  const title = `🚨 GCP ALERT · BTC YES [${timestamp}]`;
  const body = `Unique GCP Alert sent at ${timestamp} · Gap $62.00 · Cushion $25 · 4m left`;

  console.log(`Sending unique GCP alert to valid token: ${validExpoToken}`);

  const res = await sendPushNotification([validExpoToken], title, body, {
    asset: 'BTC',
    ticker: 'KXBTCUSD-26SEP05-T120000',
    type: 'lean_signal',
    source: 'gcp',
  });

  console.log('Push Result:', res);
}

main().catch(console.error);
