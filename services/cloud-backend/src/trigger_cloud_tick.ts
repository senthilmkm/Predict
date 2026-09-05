async function main() {
  console.log('Triggering Cloud API /tick endpoint...');
  const res = await fetch('https://predict-cloud-api-428463178740.us-east1.run.app/tick?single=true', {
    method: 'POST',
  });
  const data = await res.json();
  console.log('Cloud Tick Response:', JSON.stringify(data, null, 2));
}

main().catch(console.error);

export {};
