# Meta App Review resubmission — approval draft

Prepared July 22, 2026. Do not submit or remove permissions in Meta until the owner approves this document.

## Scope and authorization model

DEEZ Business Suite is an internal, server-to-server application used only by DEEZ staff for brands, Facebook Pages, Instagram professional accounts, the Happybuy WhatsApp Business Account, and catalogs owned by the DEEZ business portfolio.

- No external-business onboarding.
- No Tech Provider functionality or access.
- No public Facebook Login in DEEZ Business Suite.
- Staff authenticate at `https://app.deez.lk/` with the application's own login.
- Meta Graph access uses server-side tokens for assets assigned to the DEEZ Business Manager System User **DEEZ API Bot**.
- The screencast must show the Meta administrator login and system-user permission/asset granting flow. It must explicitly explain why there is no frontend Meta Login inside DEEZ Business Suite.

## Live Meta status inspected July 22, 2026

App: **DEEZ Business Suite**, app ID `946765651457377`.

The latest completed review approved:

- `pages_show_list`
- `pages_manage_metadata`
- `pages_messaging`
- `business_management`

It rejected:

- `pages_manage_posts`
- `instagram_content_publish`
- `pages_read_engagement`
- `instagram_basic`

Meta marked every rejected request **Screencast Not Aligned with Use Case Details**. The reviewer said the use cases are allowed, but the recording did not show:

1. the complete Meta login/authorization flow;
2. the user granting the requested permission; and
3. the permission's complete end-to-end use inside the product.

Meta also instructed server-to-server/system-user apps to state clearly that frontend Meta Login is not visible.

The current not-submitted draft was updated after owner approval on July 22, 2026:

- staged new/rejected requests: `instagram_content_publish`, `instagram_basic`, `pages_read_engagement`, `pages_manage_posts`;
- pending test-call gate: `pages_read_user_content` cannot yet be added because Meta shows `0 of 1 API call(s) required` and only offers **Ready for testing**;
- existing-access renewals retained: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `business_management`;
- removed from the draft: `whatsapp_business_messaging`, `whatsapp_business_management`.

The four approved renewal allowed-use checkboxes are certified in the draft. Their Advanced Access remains approved while the renewal is pending.

The four staged requests now contain accurate owned-assets-only, server-to-server descriptions and allowed-use certifications. Their required screencast uploads are still empty. Meta Testing currently shows completed evidence for `pages_read_engagement`, `instagram_basic`, and `instagram_content_publish`; `pages_manage_posts` and `pages_read_user_content` each still require one successful API call.

## Application audit and fixes

### Fixed: real Page read evidence

Meta Status now includes **Facebook post verification** for each configured brand. The control calls the Graph API with the saved Page token and displays:

- Page name and full Page ID;
- recent published post ID;
- post message;
- creation time;
- reactions, comments, and shares;
- recent user-generated comments; and
- a link to the live Facebook permalink.

This is direct product evidence for `pages_read_engagement` and its required `pages_read_user_content` dependency. Internal publish history alone is not presented as evidence of a Meta read.

### Fixed: catalog scope mismatch

The product create/update paths no longer send immediate Catalog Graph API upserts or deletions. Meta Status no longer exposes **Test catalog** or **Sync products now**. It describes the scheduled CSV feed as the sole catalog integration.

Therefore, do not request `catalog_management`.

### Verified: existing implementation

- `pages_manage_posts`: Content Studio publishes Page feed posts and Page photos and records Meta's returned post ID.
- `instagram_content_publish`: Content Studio creates Instagram media containers, waits for processing, publishes them, and records the returned media ID. Single-image and carousel posts are supported.
- `instagram_basic`: Meta Status reads the configured professional account's ID, username, and name from Meta.
- `pages_read_engagement`: the new Facebook post verification control reads published Page content and engagement values.
- `pages_read_user_content`: the same control reads recent user comments on the owned Page's posts.
- Happybuy WhatsApp messaging is working in production: the live Meta Status screen showed 20 WhatsApp webhook events in the last 24 hours with zero failures at inspection time. This is evidence not to seek WhatsApp Advanced Access yet.

## Final permission list for approval

### New or rejected access to submit

| Permission | Why it is necessary | Dependency status |
| --- | --- | --- |
| `pages_manage_posts` | Publish DEEZ-owned Page posts from Content Studio. | Requires `pages_read_engagement` and `pages_show_list`. |
| `pages_read_engagement` | Read back and verify Page posts and engagement in Meta Status. | Requires `pages_show_list`. |
| `instagram_basic` | Identify the connected DEEZ-owned Instagram professional account. | Requires `pages_read_user_content` and `pages_show_list`. |
| `instagram_content_publish` | Publish images/carousels from Content Studio to DEEZ-owned Instagram feeds. | Requires `instagram_basic`, `pages_read_engagement`, and `pages_show_list`. |
| `pages_read_user_content` | Required by Meta for `instagram_basic`; the app narrowly displays recent comments on owned Page posts. | Requires `pages_show_list`. |

`pages_read_user_content` is the only additional permission discovered as strictly required by Meta's current permission dependency reference.

### Existing access to renew in the same draft

| Permission | Current need |
| --- | --- |
| `pages_show_list` | Required dependency for all five requests above. Do not claim that the current UI lists `/me/accounts`; describe it as a dependency. |
| `pages_manage_metadata` | Supports the existing Page webhook subscription used by Messenger. |
| `pages_messaging` | Required for the existing Support Inbox Messenger reply workflow. |
| `business_management` | Retain for the existing DEEZ system-user/owned-business asset authorization model; describe it as supporting owned-asset access, not external-business management. |

### Explicitly excluded

- `whatsapp_business_messaging` — do not submit while the owned Happybuy production workflow works without Advanced Access.
- `whatsapp_business_management` — same decision; it is also a dependency of WhatsApp messaging and must not be submitted alone.
- `catalog_management` — scheduled CSV feed only; direct Graph synchronization is disabled.
- Any external-business onboarding, Embedded Signup, or Tech Provider permission/feature.

## Evidence requirements

Prepare one continuous English-language screencast with narration or burned-in captions. Use a test post/comment created for review and remove it after the review if appropriate. Never show access tokens, secrets, passwords, OTPs, or recovery codes.

| Evidence | What must be visible |
| --- | --- |
| Meta authorization | Sign in to Meta Business Settings; show the DEEZ business portfolio, DEEZ API Bot system user, app assignment, owned Page/Instagram assignments, and the granted permission names. Explain that this replaces frontend Facebook Login for this server-to-server app. |
| Reviewer access | A working DEEZ internal reviewer account and exact login/navigation instructions. |
| `pages_manage_posts` | Create and publish a Facebook post in Content Studio; show success and returned post ID; open the same live Page post. |
| `pages_read_engagement` | In Meta Status, load recent Page posts; show the same post ID, message, time, permalink, and engagement totals; open the permalink. |
| `pages_read_user_content` | Add a test comment from a non-Page account; reload Facebook post verification; show the comment text inside DEEZ and on the live post. State that this permission is also a required dependency of `instagram_basic`. |
| `instagram_basic` | Test the Instagram connection in Meta Status; show returned username/ID and compare it with the owned Instagram asset selected in Meta. |
| `instagram_content_publish` | Publish a new image post from Content Studio; show returned media ID; open the same post on the owned Instagram account. |
| Existing Messenger renewal | Send a reply from Support Inbox and show it arrive in Messenger. If renewal asks for subscription evidence, show the owned Page's existing webhook subscription without claiming external onboarding. |
| Ownership boundary | State and show that only DEEZ portfolio assets are configured. No external businesses or Tech Provider flow may appear. |

## Current draft readiness and remaining gates

Completed in Meta on July 22, 2026:

- removed both unsubmitted WhatsApp permissions;
- staged all four previously rejected permissions;
- preserved and certified all four approved renewals;
- replaced the four rejected-permission descriptions with accurate server-to-server, owned-assets-only notes;
- replaced the general reviewer navigation instructions with steps for Meta Status, Facebook publishing/read-back/comments, Instagram identity, and Instagram publishing;
- left the existing reviewer credential field unchanged and did not expose the credential in this document;
- did not click **Submit for review**.

Still required before submission:

1. Generate or refresh an authorized DEEZ system-user/Page token that includes `pages_read_user_content`. The owner must copy and enter the token; never include it in a recording or submission note.
2. Make one read call for user-generated Page content so Meta Testing records `pages_read_user_content`.
3. Make one disposable Facebook Page publish call so Meta Testing records `pages_manage_posts`. This creates external content and requires owner approval immediately before the test.
4. Wait up to 24 hours for Meta Testing to display the completed calls, then add `pages_read_user_content` to the draft.
5. Record the replacement end-to-end screencast, add final timestamps to each permission description, upload it to every requested-permission questionnaire, and replace the older failed-review video in Reviewer instructions.
6. Review the Data handling form with the owner/legal contact. It is currently prefilled with Vercel Inc. as a processor, DEEZ in Sri Lanka as controller, no national-security disclosure, and four public-authority-request safeguards. Confirm the production database/storage processor and the legal-response answers before certifying them.
7. Recheck reviewer credentials in a private browser and confirm the account can access Meta Status, Content Studio, History, and Support Inbox.

## End-to-end screencast checklist

Suggested duration: 8–12 minutes. Record at readable resolution with browser zoom near 100%.

### 00:00–01:30 — Meta login and permission granting

- Start signed out of Meta or at the Meta login screen; complete the Meta administrator login without exposing credentials.
- Open DEEZ Business Settings.
- Show the business portfolio ID and the **DEEZ API Bot** System User.
- Show the DEEZ Business Suite app assignment.
- Show only DEEZ-owned Page and Instagram asset assignments.
- Show the granted permission names. If generating a fresh review token, show the permission selection, then hide the resulting token completely.
- Caption: “DEEZ Business Suite is server-to-server. This System User authorization is the Meta permission-granting flow; the product has no public Facebook Login and does not onboard external businesses.”

### 01:30–02:00 — DEEZ staff login

- Open `https://app.deez.lk/` signed out.
- Log in with the reviewer/admin test account.
- State that this is internal staff authentication, separate from Meta authorization.

### 02:00–03:00 — Instagram identity (`instagram_basic`)

- Go to **Settings > Meta Status**.
- In the DEEZ Instagram card, click **Test IG token**.
- Show the resolved username/account result and match it to the owned Instagram asset shown earlier.

### 03:00–04:30 — Facebook publish (`pages_manage_posts`)

- Go to **Content Studio** and create a Facebook-only test post for the DEEZ brand.
- Use a distinctive caption containing the review date/time.
- Publish it.
- Open **History** and show the successful Facebook result and external post ID.
- Open the live DEEZ Facebook Page and show the same post.

### 04:30–06:00 — Facebook read and comment (`pages_read_engagement`, `pages_read_user_content`)

- From a non-Page test account, add a distinctive comment to the new post.
- Return to **Settings > Meta Status**.
- In the DEEZ Facebook card, click **Load recent Page posts**.
- Show “Loaded live from Meta,” the full Page ID, matching post ID/message/time, engagement totals, and the test comment.
- Click **Open live Facebook post** and compare the live object.

### 06:00–07:30 — Instagram publish (`instagram_content_publish`)

- Return to **Content Studio**.
- Create an Instagram-only post for DEEZ with at least one image.
- Publish it.
- Show the success result and external media ID in History.
- Open the owned DEEZ Instagram account and show the same live post.

### 07:30–08:30 — Existing access and scope boundary

- If renewal evidence is requested, reply to an owned Page customer conversation from Support Inbox and show delivery in Messenger.
- Briefly show that Happybuy WhatsApp is already processing production events; state that WhatsApp Advanced Access is not part of this request.
- Open the catalog section and show the scheduled CSV feed wording; state that no direct Catalog Graph API sync is used and `catalog_management` is not requested.
- End with the owned-assets-only/no-Tech-Provider statement.

## Submission notes

Use this introduction in every request:

> DEEZ Business Suite is an internal server-to-server application used only by DEEZ staff for assets owned by the DEEZ business portfolio. It does not onboard external businesses and is not a Tech Provider. Meta access is authorized through the DEEZ Business Manager System User “DEEZ API Bot”; therefore no frontend Facebook Login appears inside the product. The screencast begins with the Meta administrator login, System User permission granting, and owned-asset assignments before showing this permission's complete use in DEEZ Business Suite.

### `pages_manage_posts`

> DEEZ administrators use this permission to publish product marketing posts to DEEZ-owned Facebook Pages. At [timestamp], the screencast creates and publishes a post in Content Studio, shows Meta's returned post ID in History, and opens the same post on the owned Page.

### `pages_read_engagement`

> DEEZ administrators use this permission to read back and verify content published to our owned Pages. At [timestamp], Meta Status loads the newly published post directly from Meta and displays its post ID, message, creation time, permalink, reactions, comments, and shares before opening the matching live post.

### `pages_read_user_content`

> Meta lists this permission as a dependency of `instagram_basic`. DEEZ also uses it narrowly to display recent user comments on posts from our owned Pages for internal content verification. At [timestamp], a test user comments on the review post and Meta Status loads and displays that same comment inside DEEZ Business Suite.

### `instagram_basic`

> DEEZ uses this permission to identify and verify the connected DEEZ-owned Instagram professional account. At [timestamp], Meta Status reads the account ID and username from Meta and the screencast matches them to the owned Instagram asset assigned to DEEZ API Bot.

### `instagram_content_publish`

> DEEZ administrators use this permission to publish organic product images and captions to DEEZ-owned Instagram professional accounts. At [timestamp], the screencast publishes an image post from Content Studio, shows Meta's returned media ID in History, and opens the same post on the owned Instagram account.

### Existing-access renewal dependency note

> `pages_show_list` is retained as a required dependency of `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, and `pages_read_user_content`. DEEZ does not use it to onboard external businesses. `business_management` supports our existing system-user authorization for DEEZ-owned assets only. `pages_manage_metadata` and `pages_messaging` support the existing owned-Page Messenger webhook and Support Inbox reply workflow.

## Approval gate

Before changing the Meta draft or submitting:

- [x] Owner approves the five new/rejected requests and four existing-access renewals listed above.
- [x] Owner approves removing both WhatsApp permissions from the current draft.
- [x] The Page verification feature is deployed to production.
- [ ] The Page verification feature succeeds with a refreshed DEEZ Page token containing `pages_read_user_content`.
- [ ] A test Page comment is visible in the new panel.
- [ ] Facebook and Instagram publishing succeed in production with disposable review content.
- [x] Reviewer credentials exist and exact navigation steps are prepared.
- [ ] Reviewer credentials are privately re-tested immediately before submission.
- [ ] The owner/legal contact confirms every prefilled Data handling answer and all processors.
- [ ] The final video link works without requesting access.
- [ ] Each note contains the final video timestamp.
- [ ] No token, password, app secret, phone PIN, or private identifier is visible.
- [ ] No submission button is clicked until explicit owner approval is received.
