import { Firestore } from '@google-cloud/firestore';

async function main() {
  const db = new Firestore({ projectId: 'predict-trading-0904' });
  const userId = 'usr_q9ux0gtmtnhl8w5';

  console.log('=== CHECKING ALERTS FOR USER ===', userId);

  // 1. Subcollection users/{userId}/alerts
  const userAlertsSnap = await db.collection('users').doc(userId).collection('alerts').get();
  console.log(`Subcollection users/${userId}/alerts count:`, userAlertsSnap.size);
  userAlertsSnap.forEach((doc) => {
    console.log(`Alert [${doc.id}]:`, JSON.stringify(doc.data(), null, 2));
  });

  // 2. Subcollection users/{userId}/audit_logs
  const auditSnap = await db.collection('users').doc(userId).collection('audit_logs').orderBy('timestamp', 'desc').limit(10).get();
  console.log(`Subcollection users/${userId}/audit_logs count:`, auditSnap.size);
  auditSnap.forEach((doc) => {
    console.log(`Audit [${doc.id}]:`, JSON.stringify(doc.data(), null, 2));
  });

  // 3. Subcollection users/{userId}/trades
  const tradesSnap = await db.collection('users').doc(userId).collection('trades').orderBy('createdAt', 'desc').limit(10).get();
  console.log(`Subcollection users/${userId}/trades count:`, tradesSnap.size);
  tradesSnap.forEach((doc) => {
    console.log(`Trade [${doc.id}]:`, JSON.stringify(doc.data(), null, 2));
  });

  // 4. Root collections if any
  const rootAlertsSnap = await db.collection('alerts').get();
  console.log(`Root collection /alerts count:`, rootAlertsSnap.size);
  rootAlertsSnap.forEach((doc) => {
    console.log(`Root Alert [${doc.id}]:`, JSON.stringify(doc.data(), null, 2));
  });
}

main().catch(console.error);
