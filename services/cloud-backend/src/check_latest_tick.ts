import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const doc = await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').get();
  console.log('User lastTickAt:', doc.data()?.lastTickAt);
  console.log('User updatedAt:', doc.data()?.updatedAt);
}

main().catch(console.error);
