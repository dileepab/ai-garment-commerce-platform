# Meta App Review Resubmission Guide

## Application summary

DEEZ Business Suite (GarmentOS) is an internal, server-to-server business tool used by DEEZ administrators to operate the DEEZ, Cleopatra, and Happybuy clothing brands. It is not a consumer application and does not offer Facebook Login to public users.

Administrators authenticate using the application's own email/password login. Meta API access is configured server-side using tokens assigned to DEEZ-owned Facebook Pages and Instagram professional accounts. In the App Review submission, identify the System User as **DEEZ API Bot** and explicitly state that the absence of a Facebook Login dialog is intentional.

The application is hosted at `https://app.deez.lk/`.

## Verified production behavior

The following behavior was verified against the hosted application on July 16, 2026:

- The production dashboard loads and provides multi-brand order, inventory, support, production, and analytics information.
- Content Studio supports AI image generation, AI caption generation, drafts, Facebook publishing, Instagram publishing, channel-specific retry, and publish history.
- Content Studio currently contains nine posts and three generated creatives. Eight posts have a successful publish result and one has a failed result.
- The DEEZ channel has successful Facebook and Instagram publish history.
- The Meta Status page has configured Facebook Page and Instagram account IDs and saved tokens for Cleopatra, DEEZ, and Happybuy.
- The live DEEZ Facebook Page connection test succeeds and resolves to **DEEZ** through `graph.facebook.com`.
- The live DEEZ Instagram connection test succeeds through `graph.facebook.com`.
- Messenger and Instagram webhook events have been processed in production.
- Support Inbox contains Messenger and Instagram conversations and provides a **Send Reply** action.
- Comment automation exists but is intentionally disabled pending later review.

## Important accuracy corrections

The supporting material must not claim that a permission is demonstrated when the application does not make the corresponding API call.

### `pages_show_list`

The current application uses saved Page IDs and Page access tokens. Its connection test reads a configured Page directly; it does not list Pages through `/me/accounts` or an equivalent Page-list endpoint.

This permission is already approved, so it does not need to be included in the rejected-permission resubmission. Do not describe the existing Page connection test as proof of `pages_show_list` unless a real Page-listing flow is added.

### `business_management`

The current application does not visibly query Business Manager portfolios or enumerate business assets. The video may show Meta Business Settings to establish DEEZ ownership and System User authorization, but it should not claim that the application itself reads Business Manager assets unless that feature is implemented.

This permission is already approved and does not need to be requested again.

### `pages_manage_metadata`

The application receives Page webhook events, but webhook receipt alone is not proof that the application performs an API subscription call. The recording may show the Page subscription in Meta's dashboard and the resulting events in GarmentOS. Do not claim that GarmentOS dynamically subscribes Pages unless the actual subscription API call is shown.

This permission is already approved and does not need to be requested again.

### `pages_read_engagement`

This is the main implementation gap for the rejected permissions. The current application records the post ID returned by a publish request, but it does not visibly retrieve the published Page post or engagement data from Meta. Internal publish history is not sufficient evidence of `pages_read_engagement`.

Before resubmitting this permission, add a user-facing screen such as **Facebook Post Verification** or **Recent Facebook Posts** that reads the connected Page's posts from the Graph API and displays at least:

- Page name and Page ID;
- post ID;
- message or caption;
- creation time;
- permalink; and
- an engagement value allowed by the requested permission, if used by the business workflow.

The resubmission video must show that data being loaded from Meta after publishing.

## Rejected permissions and evidence

| Permission | Current implementation | Required video evidence |
| --- | --- | --- |
| `pages_manage_posts` | Implemented. Content Studio publishes text and image posts to `/{page-id}/feed` and uploads Page photos when creatives are attached. | Publish a new Facebook post from Content Studio, show the successful result/post ID, then open the owned Facebook Page and show the same live post. |
| `instagram_content_publish` | Implemented. Content Studio creates media containers, waits for processing, and calls `/{ig-user-id}/media_publish`. Single images and carousels are supported. | Publish a new image or carousel from Content Studio, show the successful result/media ID, then open the owned Instagram account and show the same live post. |
| `instagram_basic` | Implemented. The Meta connection test reads the configured Instagram account's ID, username, and name when available. | Open Meta Status, run the Instagram connection test, and show the resolved owned account. Keep IDs masked in public documentation but readable enough in the reviewer video to compare with the owned asset. |
| `pages_read_engagement` | Not adequately demonstrated and not currently exposed as a real user-facing read workflow. | After implementing the Page-post read screen, load the newly published Facebook post from Meta and show its returned fields and permalink. |

## Recommended recording sequence

Use a continuous English-language recording with clear captions. Avoid cuts around authorization, publishing, or verification.

### 1. Explain the authorization model

Display this caption at the beginning:

> DEEZ Business Suite is an internal server-to-server tool. It does not use Facebook Login for consumers. Meta access is authorized through the DEEZ Business Manager System User, DEEZ API Bot, for DEEZ-owned assets only.

Show:

1. DEEZ Business Settings.
2. The DEEZ API Bot System User.
3. Its assignment to the owned DEEZ, Cleopatra, and Happybuy assets.
4. The app and permissions assigned to that System User.

Do not expose full access tokens, app secrets, passwords, or other credentials in the recording.

### 2. Log in to the application

1. Open `https://app.deez.lk/` in a signed-out state.
2. Log in using the internal administrator login.
3. Explain that this is staff authentication and is separate from Meta authorization.

### 3. Verify the Instagram account (`instagram_basic`)

1. Open **Settings > Meta Status**.
2. Locate the DEEZ Instagram Business connection.
3. Click **Test IG token**.
4. Show the successful resolved account result.
5. Compare the account ID/username with the DEEZ-owned Instagram asset shown earlier.

### 4. Publish to Facebook (`pages_manage_posts`)

1. Open **Content Studio**.
2. Select **Create & Post** or **Text Post**.
3. Select the DEEZ brand and Facebook channel.
4. Select a product/creative, enter or generate the caption, and continue to the publish step.
5. Click **Publish Now**.
6. Open **History** and show the Facebook success result and returned external post ID.
7. Open the live DEEZ Facebook Page and show the newly published post.

### 5. Read the Facebook post (`pages_read_engagement`)

Complete this section only after the Page-post read feature has been implemented:

1. Return to the Page-post verification/recent-posts screen in GarmentOS.
2. Refresh data from Meta.
3. Show the post created in the previous section.
4. Show its post ID, caption/message, creation time, permalink, and any engagement field actually used by the application.
5. Open the permalink to prove that the API result and live post are the same object.

### 6. Publish to Instagram (`instagram_content_publish`)

1. Return to **Content Studio**.
2. Select the DEEZ brand and Instagram channel.
3. Attach at least one image because Instagram feed publishing requires media.
4. Review the caption and click **Publish Now**.
5. Open **History** and show the Instagram success result and returned external media ID.
6. Open the live DEEZ Instagram account and show the newly published post.

### 7. Optional context for already-approved messaging permissions

These permissions do not need to be included in the rejected-permission request, but a short final section may demonstrate the application's broader legitimate use case:

1. Send a customer message to an owned Facebook Page in native Messenger.
2. Show it arriving in GarmentOS Support Inbox.
3. Reply using **Send Reply** and show delivery in Messenger.
4. Repeat with an Instagram DM if needed.

## Submission notes for the four rejected permissions

Use the following common introduction for each request:

> DEEZ Business Suite is an internal server-to-server application used only by DEEZ administrators for Facebook Pages and Instagram professional accounts owned by the DEEZ business portfolio. The application does not use Facebook Login for public users. Meta access is granted through our Business Manager System User, DEEZ API Bot. The screencast begins by showing the System User authorization and owned asset assignments before demonstrating the requested permission end to end.

### `pages_manage_posts`

> Our administrators use this permission to publish product marketing posts from GarmentOS Content Studio to DEEZ-owned Facebook Pages. In the screencast, the reviewer can see a post created and published in Content Studio, the successful Meta post ID in publish history, and the same post live on the connected Facebook Page.

### `instagram_basic`

> GarmentOS uses this permission to identify and verify the connected DEEZ-owned Instagram professional account. In the screencast, Settings > Meta Status reads the configured account's ID and username from Meta and confirms that it matches the Instagram asset assigned to our System User.

### `instagram_content_publish`

> Our administrators use this permission to publish product images and captions from Content Studio to DEEZ-owned Instagram professional accounts. The screencast shows media creation, successful publication, the returned media ID in publish history, and the same post live on Instagram.

### `pages_read_engagement`

> GarmentOS uses this permission to retrieve and verify posts published to our owned Facebook Pages and to display the post fields used by our internal content workflow. The screencast shows the application loading the newly published post from Meta, displaying its ID, message, creation time, permalink, and the engagement information used by our administrators, and then opening the live permalink.

Do not submit the `pages_read_engagement` wording above until the described read workflow exists and can be reproduced by the reviewer.

## Final compliance note

> The app is used only by DEEZ administrators for DEEZ-owned business assets. We do not use Meta data for advertising targeting, resale, or third-party business management. The screencast shows the complete server-to-server authorization context, owned asset verification, publishing workflow, Meta read-back verification, and live results on the owned Facebook and Instagram accounts.

## Pre-submission checklist

- [ ] System User and asset assignments are visible in the recording.
- [ ] Server-to-server/no Facebook Login explanation appears at the beginning and in every permission note.
- [ ] The reviewer can access `https://app.deez.lk/` with working internal test credentials.
- [ ] No passwords, access tokens, app secrets, or full private identifiers are exposed in the video.
- [ ] UI language, captions, and narration are in English.
- [ ] Facebook publishing is demonstrated from application action to live Page result.
- [ ] Instagram account metadata is visibly read from Meta.
- [ ] Instagram publishing is demonstrated from application action to live Instagram result.
- [ ] A real Page-post read workflow is implemented before requesting `pages_read_engagement` again.
- [ ] Each permission's notes contain timestamps pointing to its exact video section.
- [ ] The video link is accessible to the reviewer without requesting access.
- [ ] Production/test services and reviewer credentials remain available throughout review.
