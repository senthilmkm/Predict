import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const doc = await db.collection('users').doc('usr_q9ux0gtmtnhl8w5').get();
  console.log('User doc:', JSON.stringify(doc.data(), null, 2));

  // Also query all users in the collection to see if there are other user documents!
  const snapshot = await db.collection('users').get();
  console.log('Total user docs in collection:', snapshot.size);
  snapshot.forEach((d) => {
    console.log(`Doc ID: ${d.id}`, d.data());
  });
}

main().catch(console.error);
