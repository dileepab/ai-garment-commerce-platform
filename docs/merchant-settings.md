# Merchant Settings

Merchant settings allow owners and admins to manage business behavior from the app instead of hardcoding it in environment variables.

## Settings Precedence

GarmentOS resolves settings in this order:

1. brand-specific merchant settings
2. global merchant settings
3. environment variable fallbacks
4. built-in safe defaults

## Main Setting Groups

### Store And Support

- display name
- support phone
- support WhatsApp
- support hours
- optional custom human handoff message
- processing error fallback message

### Delivery

- Colombo delivery charge
- outside Colombo delivery charge
- Colombo estimate window
- outside Colombo estimate window

### Payments

- payment methods list
- default payment method
- online transfer label

### Automations

- cart recovery enabled
- cart recovery delay hours
- cart recovery cooldown hours
- support timeout enabled
- support timeout delay hours
- support timeout cooldown hours
- post-order follow-up enabled
- post-order follow-up delay days
- post-order follow-up window days
- reorder reminder enabled
- reorder reminder delay days
- reorder reminder window days
- purchase nudge cooldown days

## Fallback Environment Variables

These remain useful before settings are saved in the database:

```bash
STORE_SUPPORT_PHONE=""
STORE_SUPPORT_WHATSAPP=""
STORE_SUPPORT_HOURS="9:00 AM to 6:00 PM"
```

If no support contact is configured, the bot falls back to asking the customer to continue in the same chat for manual help instead of showing fake contact info.

## Brand Overrides

Each brand uses its own WhatsApp display number as both its support phone and
support WhatsApp number. Configure that number in the brand's Meta Channels
settings. The global support phone and WhatsApp values are only fallbacks for
brands that do not yet have a WhatsApp display number.

Each brand can also override the other global defaults. This is useful when:

- delivery charges differ by brand
- payment wording differs
- automation tone or timing differs

## Recommended Usage

- use global defaults for shared business rules
- keep each brand's WhatsApp display number current; it is the brand's support-center number
- override only the settings that genuinely differ by brand
- keep at least one valid support contact configured in production
- review automation timing after launch to avoid over-messaging customers
