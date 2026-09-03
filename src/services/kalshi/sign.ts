import forge from 'node-forge';

/**
 * Kalshi RSA-PSS signature (SHA-256, salt length = digest = 32).
 * Pure JS (node-forge) so it runs in Expo / React Native — not Node `crypto`.
 * Matches scripts/kalshi/kalshi-api-client.py
 */
export function signKalshiRequest(
  privateKeyPem: string,
  timestampMs: string,
  method: string,
  pathWithoutQuery: string
): string {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const message = `${timestampMs}${method.toUpperCase()}${pathWithoutQuery}`;

  const md = forge.md.sha256.create();
  md.update(message, 'utf8');

  const pss = forge.pss.create({
    md: forge.md.sha256.create(),
    mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
    saltLength: 32, // SHA-256 digest length (PSS.DIGEST_LENGTH)
  });

  const signature = privateKey.sign(md, pss);
  return forge.util.encode64(signature);
}

export function assertPemLooksValid(pem: string): void {
  if (!pem.includes('BEGIN') || !pem.includes('PRIVATE KEY')) {
    throw new Error('invalid_pem');
  }
  try {
    forge.pki.privateKeyFromPem(pem);
  } catch {
    throw new Error('invalid_pem');
  }
}
