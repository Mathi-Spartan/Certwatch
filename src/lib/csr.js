
/**
 * Generate an RSA keypair and CSR entirely in the browser.
 *
 * The private key is written into a ZIP the user downloads and is never
 * transmitted anywhere. Only the CSR — which is public by design — is sent on
 * to the CA. If this portal is ever breached there are no partner private keys
 * inside it to steal.
 */
export async function generateCsrBundle({ commonName, bits = 2048 }) {
  if (!commonName) throw new Error('This order has no common name, so a CSR cannot be built');

  // Loaded on demand: these two libraries are only needed when someone asks us
  // to make a keypair, so they stay out of the main bundle.
  const [{ default: forge }, { default: JSZip }] = await Promise.all([
    import('node-forge'),
    import('jszip'),
  ]);

  const keys = await new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: Number(bits), workers: -1 }, (err, kp) =>
      err ? reject(new Error('Key generation failed in this browser')) : resolve(kp));
  });

  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([{ name: 'commonName', value: commonName }]);
  csr.sign(keys.privateKey, forge.md.sha256.create());

  // node-forge emits CRLF. Some CA parsers reject that outright, so normalise
  // here as well as on the server — the ZIP the user keeps should match exactly
  // what was submitted.
  const csrPem = forge.pki.certificationRequestToPem(csr).replace(/\r\n/g, '\n');
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey).replace(/\r\n/g, '\n');
  const base = commonName.replace(/^\*\./, 'wildcard.').replace(/[^a-z0-9.-]/gi, '_');

  async function downloadZip() {
    const zip = new JSZip();
    zip.file(`${base}.csr`, csrPem);
    zip.file(`${base}.key`, keyPem);
    zip.file('README.txt',
      [
        `Certificate signing request and private key for ${commonName}`,
        `Generated ${new Date().toISOString()} in your browser by Certwatch.`,
        '',
        'The .key file is your private key. It was never sent to Certwatch and',
        'cannot be recovered from us. Keep it safe — you need it to install the',
        'certificate once the CA issues it.',
      ].join('\n'));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${base}-csr-and-key.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { csrPem, keyPem, downloadZip };
}
