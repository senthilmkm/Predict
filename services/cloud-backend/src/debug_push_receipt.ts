import { Firestore } from '@google-cloud/firestore';

async function main() {
  const token = 'ExponentPushToken[HrXfGvHNjfMvsDpWUr_yHJ]';

  const message = {
    to: token,
    sound: 'default',
    priority: 'high',
    title: 'Signal · BTC YES',
    body: 'TEST GCP ALERT · Gap $48.50 · Cushion $25 · 10m left',
    _contentAvailable: true,
    interruptionLevel: 'active',
    data: { source: 'gcp', asset: 'BTC', type: 'lean_signal' },
  };

  console.log('Sending message via Expo Push API...');
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([message]),
  });

  const resData: any = await res.json();
  console.log('Send response:', JSON.stringify(resData, null, 2));

  const ticketId = resData?.data?.[0]?.id;
  if (!ticketId) {
    console.log('No ticket ID returned.');
    return;
  }

  console.log(`Got ticket ID: ${ticketId}. Waiting 3 seconds to fetch delivery receipt...`);
  await new Promise((r) => setTimeout(r, 3000));

  const receiptRes = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: [ticketId] }),
  });

  const receiptData = await receiptRes.json();
  console.log('Receipt response:', JSON.stringify(receiptData, null, 2));
}

main().catch(console.error);
