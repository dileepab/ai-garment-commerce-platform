# Meta App Review Packet

Last updated: June 4, 2026

This packet is for submitting the DEEZ / GarmentOS Meta app for App Review after Business Verification is complete.

## Review Goal

Request Advanced Access for the permissions needed to let authorized DEEZ staff connect DEEZ-owned Facebook Pages and Instagram Professional accounts, receive customer messages through Meta webhooks, reply from the GarmentOS support inbox, and manage approved brand content.

Primary app URLs:

- App dashboard: `https://developers.facebook.com/apps/`
- Public site: `https://deez-platform.vercel.app/`
- Privacy Policy: `https://deez-platform.vercel.app/privacy`
- Terms: `https://deez-platform.vercel.app/terms`
- Data Deletion Instructions: `https://deez-platform.vercel.app/data-deletion`
- Data Deletion Callback: `https://deez-platform.vercel.app/api/data-deletion`

Production callback URLs:

- Messenger webhook: `https://<production-platform-domain>/api/webhooks/meta/messenger`
- Instagram webhook: `https://<production-platform-domain>/api/webhooks/meta/instagram`

Replace `<production-platform-domain>` with the deployed GarmentOS app domain, not the public legal/static site unless both are hosted together.

## Permissions To Request

Meta's Messenger Platform documentation lists these permissions for Messenger conversations:

- `pages_show_list`
- `pages_manage_metadata`
- `pages_messaging`
- `pages_read_engagement`
- `business_management`

For Instagram Messaging, also request:

- `instagram_basic`
- `instagram_manage_messages`

Only request publishing/comment permissions in this review if you will demonstrate those flows end to end in the same submission. The current safest review scope is Messenger plus Instagram DM support.

Optional later review permissions:

- `pages_manage_posts`
- `pages_manage_engagement`
- `pages_read_user_content`
- `instagram_content_publish`
- Instagram comment-management permissions, depending on the API product shown in the dashboard

## Permission Justifications

Use these as the starting point for the permission explanation boxes.

### `pages_show_list`

GarmentOS uses this permission so an authorized DEEZ business admin can select the Facebook Page that belongs to each DEEZ brand during the Meta connection flow. The app only uses the Page list to connect the correct brand Page to the GarmentOS support and operations dashboard.

### `pages_manage_metadata`

GarmentOS uses this permission to subscribe connected DEEZ brand Pages to Meta webhook events and keep the Page connection healthy. This is required so the app can receive customer Messenger events for the connected Page and route them to the correct brand inbox.

### `pages_messaging`

GarmentOS uses this permission to receive and send Messenger messages on behalf of connected DEEZ brand Pages. Customer messages are shown in the GarmentOS support inbox, where authorized staff or approved automation can respond with product availability, size guidance, order help, and escalation support.

### `pages_read_engagement`

GarmentOS uses this permission to read Page-level context needed for connected Page operations and message/comment support workflows. The app uses this only for DEEZ-owned Pages connected by an authorized admin and does not sell or share this data.

### `business_management`

GarmentOS requests this as a dependency for connecting and managing business assets used by Messenger and Instagram Messaging. During the screencast, show the Page admin completing the Facebook Login for Business flow, selecting the DEEZ Page and Instagram account, and granting the requested permissions.

### `instagram_basic`

GarmentOS uses this permission to identify the connected Instagram Professional account for each DEEZ brand and confirm that messages are routed to the correct brand inbox.

### `instagram_manage_messages`

GarmentOS uses this permission to receive and reply to Instagram DMs for connected DEEZ brand Instagram Professional accounts. Incoming customer DMs are routed to the GarmentOS support inbox, where authorized staff or approved automation can provide product, size, order, and support responses.

## App Verification Details

Use this wording where Meta asks for app-level verification details.

GarmentOS is a private fashion commerce operations platform operated by DEEZ for DEEZ-owned brands including Happy Buy, Cleopatra, and Modabella. The app helps authorized staff manage customer conversations, product support, orders, and brand operations from Facebook Messenger and Instagram DM.

The app does not provide consumer login. Meta permissions are used only by authorized DEEZ business admins to connect DEEZ-owned Facebook Pages and Instagram Professional accounts. Customer messages are received through Meta webhooks and displayed in the GarmentOS support inbox. Replies are sent only in response to customer-initiated conversations and are used for customer support, product availability, size guidance, order updates, and escalation to human staff.

## Reviewer Access Instructions

Provide a reviewer account with limited access and valid test data.

1. Open the GarmentOS production URL: `https://<production-platform-domain>/login`.
2. Sign in with the reviewer credentials supplied in the App Review form.
3. Open `Settings > Meta Status`.
4. Confirm that the configured DEEZ test brand shows Facebook and/or Instagram channel health.
5. Open `Support`.
6. Send a test message to the connected Facebook Page or Instagram Professional account.
7. Confirm the message appears in the GarmentOS support inbox.
8. Reply from GarmentOS.
9. Confirm the reply is delivered in Messenger or Instagram DM.
10. Open `Settings > Audit` or the support transcript to confirm the event was logged.

Reviewer account recommendation:

- Role: `support` or `admin`
- Brand scope: one test brand only if possible
- Password: unique temporary password
- Remove or rotate immediately after review

## Screencast Script

Record a single clear video. Keep the browser zoom normal, avoid hidden/private windows that obscure URLs, and show the full end-to-end use case.

1. Show the public DEEZ Platform site, Privacy Policy, and Data Deletion page.
2. Show the GarmentOS login page and sign in as the reviewer/demo user.
3. Open `Settings > Meta Status`.
4. Show the connected Facebook Page and Instagram Professional account health checks.
5. If Meta Login for Business is available in the production build, show the business admin selecting the DEEZ Page and Instagram account and approving permissions.
6. Open the connected Facebook Page in Messenger and send: `Hi, do you have size M in the black linen blazer?`
7. Return to GarmentOS `Support` and show the incoming Messenger conversation.
8. Send a reply from GarmentOS, such as: `Yes, size M is available. We can help reserve it or create an order for you.`
9. Return to Messenger and show the delivered reply.
10. Repeat with Instagram DM if requesting `instagram_manage_messages`.
11. Show the support transcript/order context to demonstrate the message is used for customer support.
12. Show logout.

Do not rely only on Meta Developer Dashboard screenshots. The video must show the customer action, webhook-driven inbox event, staff/automation reply, and delivery back to the customer.

## Pre-Submit Checklist

Complete these before clicking Submit for Review.

- Business Verification shows complete in the Meta business/app dashboard.
- App mode and app category are set appropriately for a business messaging app.
- App icon, app name, contact email, privacy policy URL, and data deletion URL/callback are configured.
- Production GarmentOS URL is public over HTTPS.
- Production webhook routes verify with the same `META_VERIFY_TOKEN` configured in Meta.
- `APP_BASE_URL` points to the public GarmentOS deployment.
- Per-brand Page IDs, Instagram account IDs, and access tokens are saved in `Settings` or configured in production env vars.
- Test reviewer user exists and can access `Support` plus `Settings > Meta Status`.
- A real DEEZ-owned Facebook Page is connected.
- A real Instagram Professional account is connected to the Facebook Page if requesting Instagram messaging.
- The Page access token has the requested permissions.
- The Page is subscribed to the Messenger webhook fields.
- A successful Messenger message has been sent and replied to from GarmentOS within the last 30 days.
- A successful Instagram DM has been sent and replied to from GarmentOS within the last 30 days if requesting `instagram_manage_messages`.
- The screencast demonstrates every requested permission in the product UI.
- Temporary reviewer password is ready to rotate after review.

## Local Verification Commands

From `platform/`:

```bash
npm run lint
npm run build
npm run check:meta -- --brand happyby
```

To inspect token scopes, add `META_APP_ID` and `META_APP_SECRET` to the local environment or pass:

```bash
npm run check:meta -- --brand happyby --app-id <app-id> --app-secret <app-secret>
```

For a webhook simulation:

```bash
node scripts/simulate-messenger-flow.js --base-url https://<production-platform-domain> --sender meta-review-test "I need size M"
```

## Submission Notes

Suggested note:

GarmentOS uses Meta permissions only for DEEZ-owned business assets connected by authorized DEEZ staff. Messenger and Instagram messages are customer-initiated. The app routes incoming messages from Meta webhooks into the GarmentOS support inbox, where authorized staff or approved automation replies with product, size, order, delivery, and support information. The screencast shows the complete flow from customer message to inbox receipt to reply delivery.

Data handling note:

GarmentOS stores message text, sender IDs, conversation history, order details, and staff audit events only as needed to provide customer support and commerce operations for DEEZ brands. The public Privacy Policy and Data Deletion pages explain how customers can request deletion. DEEZ does not sell Meta platform data.

## Common Rejection Fixes

- If Meta says the screencast is incomplete, record a new one showing the actual message sent by the customer, the message appearing in GarmentOS, and the reply delivered back in Messenger/Instagram.
- If Meta says the permission is not used, remove that permission from the request or add a visible product flow that demonstrates it.
- If token/API usage checks are missing, run a real successful Graph API call and send/receive test message using the permission before resubmitting.
- If webhooks fail, verify the callback URL, `META_VERIFY_TOKEN`, HTTPS certificate, and Page subscriptions.
- If reviewer cannot access the app, reset the reviewer password and test the exact credentials in a clean browser before resubmission.
