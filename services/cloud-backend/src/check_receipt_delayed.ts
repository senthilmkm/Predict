async function main() {
  const token = 'ExponentPushToken[HrXfGvHNjfMvsDpWUr_yHJ]';
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        to: token,
        sound: 'default',
        priority: 'high',
        title: 'Signal · BTC YES (Test Alert)',
        body: 'Testing GCP alert delivery receipt check',
        data: { source: 'gcp', asset: 'BTC', type: 'lean_signal' },
      },
    ]),
  });

  const resData: any = await res.json();
  const ticketId = resData?.data?.[0]?.id;
  console.log('Ticket ID:', ticketId);

  console.log('Waiting 15 seconds for APNs/FCM delivery receipt...');
  await new Promise((r) => setTimeout(r, 15000));

  const receiptRes = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: [ticketId] }),
  });

  const receiptData = await receiptRes.json();
  console.log('Receipt response:', JSON.stringify(receiptData, null, 2));
}

main().catch(console.error);
