import { sendPushNotification } from './services/notifications';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const snapshot = await db.collection('users').get();

  const allTokens: string[] = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    const tokens = [
      ...(data?.pushTokens || []),
      ...(data?.fcmTokens || []),
    ].filter(Boolean);
    allTokens.push(...tokens);
  });

  const uniqueTokens = Array.from(new Set(allTokens));
  console.log('Sending test GCP alert to all unique tokens in Firestore:', uniqueTokens);

  if (uniqueTokens.length === 0) {
    console.log('No push tokens found in Firestore DB!');
    return;
  }

  const title = 'Signal · BTC YES (Test GCP Alert)';
  const body = `TEST GCP ALERT · Gap $48.50 · Cushion $25 · 10m left`;

  const res = await sendPushNotification(uniqueTokens, title, body, {
    asset: 'BTC',
    ticker: 'KXBTCUSD-26SEP05-T100000',
    type: 'lean_signal',
    source: 'gcp',
  });

  console.log('Push send result:', res);
}

main().catch(console.error);
