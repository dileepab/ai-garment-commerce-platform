This is the operations and AI sales platform for the garment business demo app. It includes product management, order handling, production tracking, Messenger webhook flows, and AI-assisted customer replies.

## Getting Started

1. Create a local env file from the example:

```bash
cp .env.example .env
```

2. Point `.env` at PostgreSQL and fill in the required API keys and Meta values.

Important production values:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/garment_platform"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/garment_platform"
AUTH_SECRET="generate_with_openssl_rand_hex_32"
ADMIN_EMAIL="admin@garment.lk"
ADMIN_PASSWORD="use_a_strong_unique_password"
APP_BASE_URL="https://your-public-app-url.example.com"
META_VERIFY_TOKEN="your_meta_verify_token"
META_PAGE_ACCESS_TOKEN="your_meta_page_access_token"
META_GRAPH_VERSION="v22.0"
HAPPYBY_PAGE_ID="your_happyby_page_id"
CLEOPATRA_PAGE_ID="your_cleopatra_page_id"
MODABELLA_PAGE_ID="your_modabella_page_id"
HAPPYBY_INSTAGRAM_ID="your_happyby_instagram_business_account_id"
```

`DATABASE_URL` is used by the app at runtime. `DIRECT_URL` is used by Prisma migrations and other schema management commands.

`APP_BASE_URL` is used for public media fallbacks, which helps keep size-chart delivery reliable when Messenger cannot reuse a locally uploaded asset. On Vercel, this can be omitted if you enable system environment variables, because the app now falls back to the Vercel deployment URL automatically.

`AUTH_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` protect the admin UI. Generate `AUTH_SECRET` with `openssl rand -hex 32`, and do not deploy with the placeholder admin password.

`META_VERIFY_TOKEN` must match the verify token configured in Meta. `META_PAGE_ACCESS_TOKEN` must be a Page access token that can send Messenger and Instagram replies for the connected assets.

3. Apply the PostgreSQL schema and seed demo data:

```bash
npm run db:deploy
npm run db:seed
```

4. Run the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The app auto-updates as you edit files in `src/`.

## Migrating Existing SQLite Data

If you already have data in `prisma/dev.db`, move it into PostgreSQL after setting `DATABASE_URL` to the destination database:

```bash
npm run db:migrate:sqlite-to-postgres
```

If the destination database already contains data and you intentionally want to replace it:

```bash
npm run db:migrate:sqlite-to-postgres -- --force
```

To read from a different SQLite file:

```bash
npm run db:migrate:sqlite-to-postgres -- --sqlite-path=path/to/source.db
```

## Merchant Settings

Owners and admins can manage support contact details, delivery charges and windows, payment methods, customer-facing fallback wording, and retention automation timing from `/settings`. Global defaults apply to every store, and brand-specific rows override those defaults for customer-facing chat and automation behavior.

## Support Handoff Setup

The customer-support flow can hand customers to a real person. These values can now be managed from `/settings`; the `.env` values below remain as startup fallbacks before a merchant settings row exists:

```bash
STORE_SUPPORT_PHONE="0701234567"
STORE_SUPPORT_WHATSAPP="0701234567"
STORE_SUPPORT_HOURS="9:00 AM to 6:00 PM"
```

If these values are left empty, the bot will safely ask the customer to reply in the same chat and wait for a manual follow-up instead of showing a fake number.

Repeated automation failures and repeated unclear replies are escalated into the support inbox. Keep at least one real support contact configured in production so those fallback replies give customers a usable path.

## Meta Webhooks

Configure Meta callbacks to the deployed routes:

- Messenger: `https://your-domain.example.com/api/webhooks/meta/messenger`
- Instagram: `https://your-domain.example.com/api/webhooks/meta/instagram`

Both routes use the same `META_VERIFY_TOKEN`. Messenger brand routing uses `HAPPYBY_PAGE_ID`, `CLEOPATRA_PAGE_ID`, and `MODABELLA_PAGE_ID`. Instagram brand routing uses `HAPPYBY_INSTAGRAM_ID`, `CLEOPATRA_INSTAGRAM_ID`, and `MODABELLA_INSTAGRAM_ID`.

The webhook handlers process every item in a Meta batch independently. Duplicate message/comment event IDs are skipped through `WebhookEventLog`, and processing/delivery failures are logged with a compact batch summary so Meta retries do not accidentally duplicate orders.

## Instagram Setup

Connect each Instagram professional account to its Facebook Page in Meta Business settings, then subscribe the app to Instagram messaging/comment webhook fields. Use the Instagram Business Account ID, not the username, for the `*_INSTAGRAM_ID` values.

Instagram DMs use the same outbound send helper as Messenger. Generic carousel templates may be rejected by Instagram; the app logs that rejection and keeps the text reply as the safe fallback.

## Test Simulator

You can simulate Messenger conversations locally with:

```bash
node scripts/simulate-messenger-flow.js --base-url http://127.0.0.1:3000 --reset --sender test-user "I need to talk to a real person"
```

This remains useful for local development. Once the app is deployed to Vercel, Meta can call the live webhook URLs directly, so an `ngrok` tunnel is no longer required for production traffic.

## Automated Chat Regression Tests

Run the automated Messenger regression suite with:

```bash
npm run test:chat
```

This command builds the app, starts an isolated local server in chat test mode, runs scripted customer conversations, verifies the important replies and database side effects, and then cleans up the synthetic test data it created.

The suite now covers:

- human support handoff and escalation storage
- contact collection and correction
- draft totals during an unfinished order
- gift note updates on existing orders
- multi-size-chart follow-ups
- explicit order ID lookups
- reorder-after-cancel flows
- quantity stock-cap handling

## Reset Local Chat Data

To clear local test chat history without touching orders:

```bash
npm run reset:chat
```

To clear one sender only:

```bash
npm run reset:chat -- --sender test-user
```

To fully remove one sender, including their orders, pass `--include-orders`:

```bash
npm run reset:chat -- --sender test-user --include-orders
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

1. Import the `platform/` directory as a Vercel project.

2. Set the build command to:

```bash
npm run vercel-build
```

3. Add environment variables in Vercel for at least:

```bash
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
AUTH_SECRET="..."
ADMIN_EMAIL="admin@garment.lk"
ADMIN_PASSWORD="..."
META_VERIFY_TOKEN="..."
META_PAGE_ACCESS_TOKEN="..."
HAPPYBY_PAGE_ID="..."
HAPPYBY_INSTAGRAM_ID="..."
STORE_SUPPORT_WHATSAPP="..."
```

4. For preview deployments, use a separate PostgreSQL database if you plan to run migrations from preview builds.

5. Either:

```bash
APP_BASE_URL="https://your-production-domain.example.com"
```

or enable Vercel's system environment variables so the app can derive a public base URL from `VERCEL_URL` and related deployment variables.

6. Point Meta webhook subscriptions at your live Vercel URLs:

- `https://your-domain.example.com/api/webhooks/meta/messenger`
- `https://your-domain.example.com/api/webhooks/meta/instagram`

After deployment, Meta webhook traffic can use the Vercel domain directly, which removes the old need for an `ngrok` tunnel in production.

Useful references:

- [Vercel deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Prisma deploy to Vercel guide](https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel)
