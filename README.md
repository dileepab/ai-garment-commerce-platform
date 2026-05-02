# GarmentOS

GarmentOS is an AI-powered garment commerce and operations platform for fashion brands that sell through Facebook Messenger and Instagram DM. It combines customer chat automation with back-office workflows for orders, support, inventory, production, fulfillment, analytics, and merchant configuration.

## What The App Includes

- AI-assisted Messenger and Instagram customer conversations
- Draft-to-confirmed order flow with stock-aware validation
- Human support handoff lock and support inbox workflows
- Products, inventory, production, operator, orders, analytics, and settings dashboards
- Merchant-level and brand-level runtime configuration
- Role-based access control with brand scoping
- Customer retention automations and fulfillment state tracking
- Customer self-service for safe order actions

## App Map

- `/` dashboard and business overview
- `/analytics` KPI and reporting dashboard
- `/products` catalog and inventory management
- `/orders` order operations and fulfillment workflow
- `/support` escalations, transcripts, and manual support actions
- `/production` production batches and output tracking
- `/operators` operator performance dashboard
- `/settings` merchant configuration and automation settings
- `/login` staff login

## Roles

- `owner` full access across all brands and settings
- `admin` full access across all brands and settings
- `support` support inbox, replies, and order lookup
- `operations` orders, products, inventory, production, operators, and dashboard access

Brand scoping can limit `support` and `operations` users to a subset of brands.

## Getting Started

1. Create a local env file:

```bash
cp .env.example .env
```

2. Fill the required environment variables.

Required core variables:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/garment_platform"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/garment_platform"
GEMINI_API_KEY="your_gemini_api_key"
AUTH_SECRET="generate_with_openssl_rand_hex_32"
ADMIN_EMAIL="admin@garment.lk"
ADMIN_PASSWORD="use_a_strong_unique_password"
META_VERIFY_TOKEN="your_meta_verify_token"
META_PAGE_ACCESS_TOKEN="your_meta_page_access_token"
```

Common production variables:

```bash
APP_BASE_URL="https://your-public-app-url.example.com"
META_GRAPH_VERSION="v22.0"
HAPPYBY_PAGE_ID="your_happyby_page_id"
CLEOPATRA_PAGE_ID="your_cleopatra_page_id"
MODABELLA_PAGE_ID="your_modabella_page_id"
HAPPYBY_INSTAGRAM_ID="your_happyby_instagram_business_account_id"
CLEOPATRA_INSTAGRAM_ID="your_cleopatra_instagram_business_account_id"
MODABELLA_INSTAGRAM_ID="your_modabella_instagram_business_account_id"
STORE_SUPPORT_PHONE="0701234567"
STORE_SUPPORT_WHATSAPP="0701234567"
STORE_SUPPORT_HOURS="9:00 AM to 6:00 PM"
DEBUG_APP_LOGS="0"
```

`DATABASE_URL` is used at runtime. `DIRECT_URL` is used for Prisma migrations and schema management. `APP_BASE_URL` is used for public asset fallbacks and public links when the deployment URL is not auto-detected.

3. Apply migrations and seed demo data:

```bash
npm run db:deploy
npm run db:seed
```

4. Start the app:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000).

## Authentication And Team Users

The app uses Auth.js credentials login.

- `ADMIN_EMAIL` and `ADMIN_PASSWORD` are the owner login
- additional team users can be supplied through dedicated env vars
- or multiple users can be provided through `GARMENTOS_USERS`

Examples from `.env.example`:

```bash
SUPPORT_EMAIL="support@garment.lk"
SUPPORT_PASSWORD="change_this_password"
SUPPORT_BRANDS="HappyBy,Cleopatra"

OPERATIONS_EMAIL="ops@garment.lk"
OPERATIONS_PASSWORD="change_this_password"
OPERATIONS_BRANDS="HappyBy,Cleopatra"
```

See [`docs/access-control.md`](./docs/access-control.md) for the role matrix and brand scoping rules.

## Merchant Settings

Owners and admins can configure support contact details, delivery windows, charges, payment methods, fallback wording, and automation timing from `/settings`.

Configuration precedence:

1. brand-specific merchant settings
2. global merchant settings
3. environment variable defaults
4. hardcoded safe defaults

See [`docs/merchant-settings.md`](./docs/merchant-settings.md).

## Meta Webhooks

Configure Meta callbacks to:

- Messenger: `https://your-domain.example.com/api/webhooks/meta/messenger`
- Instagram: `https://your-domain.example.com/api/webhooks/meta/instagram`

Both routes use `META_VERIFY_TOKEN`.

Brand routing:

- Messenger uses `HAPPYBY_PAGE_ID`, `CLEOPATRA_PAGE_ID`, and `MODABELLA_PAGE_ID`
- Instagram uses `HAPPYBY_INSTAGRAM_ID`, `CLEOPATRA_INSTAGRAM_ID`, and `MODABELLA_INSTAGRAM_ID`

Webhook behavior:

- every event in a Meta batch is processed independently
- duplicate message/comment/postback events are skipped with `WebhookEventLog`
- failures are logged with compact batch summaries to make retries safe

## Instagram Setup

- connect each Instagram professional account to its Facebook Page
- subscribe the app to Instagram messaging and comment webhook fields
- use the Instagram Business Account ID, not the username, for `*_INSTAGRAM_ID`

Instagram DMs share the same orchestration pipeline as Messenger. Unsupported templates are logged and safely downgraded to text replies.

## Fulfillment And Customer Self-Service

Confirmed orders can move through richer fulfillment stages such as packing, shipped, out-for-delivery, delivered, failed delivery, returned, and cancelled. Customers can safely self-serve supported actions such as status lookup and pre-shipment contact updates, while risky requests still escalate to human support.

See:

- [`docs/fulfillment-workflow.md`](./docs/fulfillment-workflow.md)
- [`docs/customer-chat-capabilities.md`](./docs/customer-chat-capabilities.md)

## Retention Automations And Cron Endpoints

Available cron routes:

- `/api/cron/cart-recovery`
- `/api/cron/human-timeout`

These power:

- incomplete order recovery
- support timeout follow-ups
- post-order follow-ups
- reorder reminders

Recommended scheduling:

- cart recovery / retention route: every 30 to 60 minutes
- human timeout route: every 30 to 60 minutes

The app enforces cooldowns and dedupe rules through runtime config and automation logs.

## Testing

Main test and validation commands:

```bash
npm run lint
npm run build
npm run test:chat
npm run test:access-control
npm run test:analytics
npm run test:retention
npm run test:fulfillment
```

Other useful commands:

```bash
npm run reset:chat
npm run check:meta
```

See [`docs/testing.md`](./docs/testing.md).

## Test Simulator

You can simulate Messenger flows locally:

```bash
node scripts/simulate-messenger-flow.js --base-url http://127.0.0.1:3000 --reset --sender test-user "I need to talk to a real person"
```

## Migrating Existing SQLite Data

If you still have data in `prisma/dev.db`, move it into PostgreSQL after setting `DATABASE_URL`:

```bash
npm run db:migrate:sqlite-to-postgres
```

To replace existing destination data intentionally:

```bash
npm run db:migrate:sqlite-to-postgres -- --force
```

To read from a different SQLite file:

```bash
npm run db:migrate:sqlite-to-postgres -- --sqlite-path=path/to/source.db
```

## Deploy On Vercel

1. Import the `platform/` directory as a Vercel project.
2. Set the build command to:

```bash
npm run vercel-build
```

3. Add production environment variables for:

```bash
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
GEMINI_API_KEY="..."
AUTH_SECRET="..."
ADMIN_EMAIL="admin@garment.lk"
ADMIN_PASSWORD="..."
META_VERIFY_TOKEN="..."
META_PAGE_ACCESS_TOKEN="..."
HAPPYBY_PAGE_ID="..."
CLEOPATRA_PAGE_ID="..."
MODABELLA_PAGE_ID="..."
HAPPYBY_INSTAGRAM_ID="..."
CLEOPATRA_INSTAGRAM_ID="..."
MODABELLA_INSTAGRAM_ID="..."
```

4. Add support fallbacks only if merchant settings have not been configured yet:

```bash
STORE_SUPPORT_PHONE="..."
STORE_SUPPORT_WHATSAPP="..."
STORE_SUPPORT_HOURS="..."
```

5. Point Meta to your live webhook URLs:

- `https://your-domain.example.com/api/webhooks/meta/messenger`
- `https://your-domain.example.com/api/webhooks/meta/instagram`

6. Schedule cron jobs for the retention endpoints if you want automation enabled in production.

## Additional Documentation

- [`docs/access-control.md`](./docs/access-control.md)
- [`docs/merchant-settings.md`](./docs/merchant-settings.md)
- [`docs/fulfillment-workflow.md`](./docs/fulfillment-workflow.md)
- [`docs/customer-chat-capabilities.md`](./docs/customer-chat-capabilities.md)
- [`docs/testing.md`](./docs/testing.md)
