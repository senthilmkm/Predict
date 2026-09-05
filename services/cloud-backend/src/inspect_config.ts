import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const doc = await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').get();
  const data = doc.data();
  console.log('--- USER DOC DATA ---');
  console.log('config:', JSON.stringify(data?.config, null, 2));
  console.log('alerts_enabled in config:', data?.config?.alerts_enabled);
  console.log('pushTokens:', data?.pushTokens);
  console.log('fcmTokens:', data?.fcmTokens);
}

main().catch(console.error);
