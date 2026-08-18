/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Prints a VAPID key pair for Web Push.
 *
 * Run this yourself and paste the values into the hosting environment. They are
 * the credentials that prove a push came from this server, so the private key
 * belongs in the environment and never in the repository.
 *
 *   node scripts/generate-vapid-keys.js
 *
 * Generate once and keep them: replacing the keys invalidates every device
 * already subscribed, and each operator has to turn notifications on again.
 */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('Add these to your environment (Vercel → Settings → Environment Variables):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   # your contact address\n');
console.log('The public key is sent to browsers. Keep the private key secret.');
