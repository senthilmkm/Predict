import { sendPushNotification } from './services/notifications';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const token = 'ExponentPushToken[HrXfGvHNjfMvsDpWUr_yHJ]';

  await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').update({
    pushTokens: [token],
    fcmTokens: [token],
  });

  const timestamp = new Date().toLocaleTimeString();
  const title = `🚨 LIVE GCP ALERT [${timestamp}]`;
  const body = `Bitcoin Gap $54.20 · Cushion $25 · 5m left`;

  console.log(`Sending standard iOS alert to token: ${token}`);

  const res = await sendPushNotification([token], title, body, {
    asset: 'BTC',
    ticker: 'KXBTCUSD-26SEP05-T100000',
    type: 'lean_signal',
    source: 'gcp',
  });

  console.log('Push Result:', res);
}

main().catch(console.error);
