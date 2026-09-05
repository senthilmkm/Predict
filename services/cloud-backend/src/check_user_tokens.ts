import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const doc = await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').get();
  if (!doc.exists) {
    console.log('User doc not found!');
    return;
  }
  const data = doc.data();
  console.log('User doc keys:', Object.keys(data || {}));
  console.log('pushTokens:', data?.pushTokens);
  console.log('fcmTokens:', data?.fcmTokens);
  console.log('state:', data?.state);
  console.log('cloudTradingEnabled:', data?.cloudTradingEnabled);
  console.log('kalshiConfigured:', data?.kalshiConfigured);
  console.log('updatedAt:', data?.updatedAt);
}

main().catch(console.error);
