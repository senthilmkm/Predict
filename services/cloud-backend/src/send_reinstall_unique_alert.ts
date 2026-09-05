import { Firestore } from '@google-cloud/firestore';

async function main() {
  const token = 'ExponentPushToken[8b2e5f7b4f2785c863b345abbeffb1b5f46d584ae503dbb21c850bba1c58735c]';

  const timestamp = new Date().toLocaleTimeString();
  const title = `🔥 UNIQUE GCP ALERT [${timestamp}]`;
  const body = `Reinstall Verification · Gold Gap $8.50 · Cushion $7 · Time ${timestamp}`;

  console.log(`Sending message to token: ${token}`);

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        to: token,
        title,
        body,
        sound: 'default',
        priority: 'high',
        data: { source: 'gcp', asset: 'Gold', type: 'lean_signal' },
      },
    ]),
  });

  const resData = await res.json();
  console.log('FULL EXPO RESPONSE:', JSON.stringify(resData, null, 2));
}

main().catch(console.error);
