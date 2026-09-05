import { sendPushNotification } from './services/notifications';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const doc = await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').get();
  if (!doc.exists) {
    console.error('User doc not found');
    return;
  }
  const data = doc.data();
  const tokens = [
    ...(data?.pushTokens || []),
    ...(data?.fcmTokens || []),
  ].filter((t, i, arr) => t && arr.indexOf(t) === i);

  console.log('Sending test GCP alert to tokens:', tokens);

  const title = 'Signal · BTC YES';
  const body = `TEST GCP ALERT · Gap $48.50 · Cushion $25 · 10m left`;

  const res = await sendPushNotification(tokens, title, body, {
    asset: 'BTC',
    ticker: 'KXBTCUSD-26SEP05-T100000',
    type: 'lean_signal',
    source: 'gcp',
  });

  console.log('Push send result:', res);
}

main().catch(console.error);
