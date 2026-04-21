This is the operations and AI sales platform for the garment business demo app. It includes product management, order handling, production tracking, Messenger webhook flows, and AI-assisted customer replies.

## Getting Started

1. Create a local env file from the example:

```bash
cp .env.example .env
```

2. Fill in the required API keys and Meta values in `.env`.

3. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

4. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The app auto-updates as you edit files in `src/`.

## Support Handoff Setup

The customer-support flow can hand customers to a real person. Configure these values in `.env` so the bot replies with your real contact details:

```bash
STORE_SUPPORT_PHONE="0701234567"
STORE_SUPPORT_WHATSAPP="0701234567"
STORE_SUPPORT_HOURS="9:00 AM to 6:00 PM"
```

If these values are left empty, the bot will safely ask the customer to reply in the same chat and wait for a manual follow-up instead of showing a fake number.

## Test Simulator

You can simulate Messenger conversations locally with:

```bash
node scripts/simulate-messenger-flow.js --base-url http://127.0.0.1:3000 --reset --sender test-user "I need to talk to a real person"
```

## Automated Chat Regression Tests

Run the automated Messenger regression suite with:

```bash
npm run test:chat
```

This command builds the app, starts an isolated local server in chat test mode, runs scripted customer conversations, verifies the important replies and database side effects, and then cleans up the synthetic test data it created.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
