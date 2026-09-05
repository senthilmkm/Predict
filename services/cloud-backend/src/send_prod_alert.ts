import { sendPushNotification } from './services/notifications';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const validToken = 'ExponentPushToken[9c19cb8a3799e55bb175150c64212798b9581952a4ca5ad5a3f7ba00628ab4d7]';

  // Update Firestore user doc with the valid production token
  await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').update({
    pushTokens: [validToken],
    fcmTokens: [validToken],
  });

  const timestamp = new Date().toLocaleTimeString();
  const title = `⚡ Signal · BTC YES [${timestamp}]`;
  const body = `Live TestFlight GCP Alert · Gap $54.20 · Cushion $25 · 5m left`;

  console.log(`Sending GCP Production Alert to fresh token: ${validToken}`);

  const res = await sendPushNotification([validToken], title, body, {
    asset: 'BTC',
    ticker: 'KXBTCUSD-26SEP05-T100000',
    type: 'lean_signal',
    source: 'gcp',
  });

  console.log('Production Push Result:', res);
}

main().catch(console.error);
