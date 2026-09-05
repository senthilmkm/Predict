async function main() {
  const ticketIds = [
    '01a07234-dec0-75a9-a691-4ecfbb3a7808',
    '01a07233-906b-773f-8a0e-f3163c22c6b2',
    '01a07230-3e90-7261-a608-8fe67427de24',
  ];

  console.log('Fetching receipts for ticket IDs:', ticketIds);

  const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ ids: ticketIds }),
  });

  const resData = await res.json();
  console.log('Receipt response:', JSON.stringify(resData, null, 2));
}

main().catch(console.error);

export {};
