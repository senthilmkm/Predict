import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const doc = await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').get();

  const data = doc.data();
  const tokens = [
    ...(data?.pushTokens || []),
    ...(data?.fcmTokens || []),
  ].filter(Boolean);

  console.log('Target tokens from Firestore:', tokens);

  const messages = tokens.map((token) => ({
    to: token,
    sound: 'default',
    title: 'Signal · BTC YES',
    body: 'TEST GCP ALERT · Gap $48.50 · Cushion $25 · 10m left',
    badge: 1,
    data: { source: 'gcp', asset: 'BTC', type: 'lean_signal' },
  }));

  console.log('Sending clean payload:', JSON.stringify(messages, null, 2));

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  const resData = await res.json();
  console.log('Expo Push API response:', JSON.stringify(resData, null, 2));
}

main().catch(console.error);
