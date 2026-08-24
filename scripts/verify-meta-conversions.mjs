/**
 * Proves the Conversions API credentials and payload actually work.
 *
 * Until a real ad-attributed order happens there is no way to tell a working
 * integration from a broken one — both look like an empty dataset. This posts
 * one synthetic Purchase and prints Meta's answer verbatim, so a bad dataset
 * id, a token without access, and a malformed payload each say which they are.
 *
 * Run with the same values that are in Vercel:
 *
 *   META_CONVERSIONS_DATASET_ID=... \
 *   META_CONVERSIONS_ACCESS_TOKEN=... \
 *   META_WHATSAPP_BUSINESS_ACCOUNT_ID=... \
 *   node scripts/verify-meta-conversions.mjs [TEST_EVENT_CODE]
 *
 * With a test event code the event lands in the Test Events tab and is never
 * counted as a sale. Without one it lands in the live dataset as a Purchase of
 * value 0 that is credited to no ad, because the click id below is fake.
 */

const dataset = (process.env.META_CONVERSIONS_DATASET_ID || '').trim();
const token = (process.env.META_CONVERSIONS_ACCESS_TOKEN || '').trim();
const waba = (process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();
const testEventCode = (process.argv[2] || process.env.META_CONVERSIONS_TEST_EVENT_CODE || '').trim();
const version = process.env.META_GRAPH_VERSION || 'v22.0';

const missing = [
  !dataset && 'META_CONVERSIONS_DATASET_ID',
  !token && 'META_CONVERSIONS_ACCESS_TOKEN',
  !waba && 'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
].filter(Boolean);

if (missing.length) {
  console.error('Missing: ' + missing.join(', '));
  process.exit(2);
}

const payload = {
  ...(testEventCode ? { test_event_code: testEventCode } : {}),
  data: [
    {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      event_id: `verify-${Date.now()}`,
      user_data: {
        whatsapp_business_account_id: waba,
        // Deliberately not a real click id. Meta accepts the event and ties it
        // to no ad, which is what we want from a check that must not move any
        // campaign's reported numbers.
        ctwa_clid: 'verification-not-a-real-click',
      },
      custom_data: { currency: 'LKR', value: 0 },
    },
  ],
};

console.log(`POST /${version}/${dataset}/events`);
console.log(`  test event code: ${testEventCode || '(none — goes to the live dataset)'}`);

const response = await fetch(
  `https://graph.facebook.com/${version}/${encodeURIComponent(dataset)}/events`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  }
);

const body = await response.text();
console.log(`\nHTTP ${response.status}`);
console.log(body);

if (!response.ok) {
  // Meta names the offending field, which is the only way to tell these apart.
  console.log('\nWhat the common failures mean:');
  console.log('  "Unsupported post request" / 400 on the id → dataset id is wrong,');
  console.log('     or the token belongs to a different business portfolio.');
  console.log('  190 → the token is expired or was revoked.');
  console.log('  200 (permissions) → the token cannot write to this dataset.');
  process.exit(1);
}

console.log('\nAccepted. Check Events Manager → Happybuy → ' +
  (testEventCode ? 'Test Events.' : 'Overview (allow a few minutes).'));
