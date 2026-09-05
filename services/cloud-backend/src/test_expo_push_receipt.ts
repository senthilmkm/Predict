async function main() {
  const token = 'ExponentPushToken[HrXfGvHNjfMvsDpWUr_yHJ]';

  console.log('Sending push notification...');
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify([
      {
        to: token,
        title: 'Signal · BTC YES (Live Test)',
        body: 'GCP Alert Push Test',
        sound: 'default',
        priority: 'high',
        channelId: 'predict-alerts',
        data: { source: 'gcp', asset: 'BTC', type: 'lean_signal' },
      },
    ]),
  });

  const resData: any = await res.json();
  console.log('Send response:', JSON.stringify(resData, null, 2));

  const ticketId = resData?.data?.[0]?.id;
  if (!ticketId) return;

  console.log(`Ticket ID: ${ticketId}. Polling receipts every 5s for 30s...`);

  for (let i = 1; i <= 6; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const receiptRes = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ ids: [ticketId] }),
    });

    const receiptData: any = await receiptRes.json();
    console.log(`[Attempt ${i}/6] Receipt response:`, JSON.stringify(receiptData, null, 2));

    if (receiptData?.data?.[ticketId]) {
      const receipt = receiptData.data[ticketId];
      if (receipt.status === 'ok') {
        console.log('✅ EXPO DELIVERED TO APNs/FCM SUCCESSFULLY!');
      } else if (receipt.status === 'error') {
        console.error('❌ EXPO APNs DELIVERY ERROR:', receipt.message, receipt.details);
      }
      break;
    }
  }
}

main().catch(console.error);
