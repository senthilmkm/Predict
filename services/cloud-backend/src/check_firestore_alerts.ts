import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  console.log('=== FIRESTORE USERS COLLECTION ===');
  const usersSnapshot = await db.collection('users').get();
  console.log(`Found ${usersSnapshot.docs.length} user document(s):\n`);

  for (const doc of usersSnapshot.docs) {
    console.log(`User ID: ${doc.id}`);
    console.log('Doc Data:', JSON.stringify(doc.data(), null, 2));

    // Check trades subcollection
    const tradesSnap = await db.collection('users').doc(doc.id).collection('trades').get();
    console.log(`  Trades count: ${tradesSnap.docs.length}`);
    tradesSnap.docs.forEach(t => {
      console.log(`    Trade (${t.id}):`, JSON.stringify(t.data()));
    });

    // Check audit subcollection
    const auditSnap = await db.collection('users').doc(doc.id).collection('audit').get();
    console.log(`  Audit logs count: ${auditSnap.docs.length}`);
    auditSnap.docs.forEach(a => {
      console.log(`    Audit (${a.id}):`, JSON.stringify(a.data()));
    });

    // Check all subcollections
    const collections = await db.collection('users').doc(doc.id).listCollections();
    console.log(`  Subcollections for user ${doc.id}: ${collections.map(c => c.id).join(', ')}`);
  }

  // Also check top-level collections
  const topCollections = await db.listCollections();
  console.log('\n=== TOP-LEVEL COLLECTIONS ===');
  console.log(topCollections.map(c => c.id).join(', '));
}

main().catch(err => {
  console.error('Error querying Firestore:', err);
  process.exit(1);
});
