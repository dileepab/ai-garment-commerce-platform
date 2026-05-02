# Testing

GarmentOS uses a mix of linting, build validation, and flow-specific regression scripts.

## Core Checks

```bash
npm run lint
npm run build
```

Run these before every merge to `main`.

## Chat Regression Suite

```bash
npm run test:chat
```

This suite validates important Messenger/Instagram-oriented conversation flows and checks message behavior plus database side effects.

Covered areas include:

- support handoff
- contact collection and correction
- draft totals
- gift note updates
- order lookups
- reorder flows
- stock-cap handling

## Access Control

```bash
npm run test:access-control
```

Use this when changing roles, brand scoping, or page permission behavior.

## Analytics

```bash
npm run test:analytics
```

Use this when changing dashboard calculations, date-range summaries, or reporting helpers.

## Retention Automation

```bash
npm run test:retention
```

Use this when changing cart recovery, post-order follow-ups, reorder reminders, or support-timeout logic.

## Fulfillment

```bash
npm run test:fulfillment
```

Use this when changing packing, shipment, delivery, failure, or return workflows.

## Useful Dev Utilities

Reset synthetic chat data:

```bash
npm run reset:chat
```

Check Meta webhook subscription state:

```bash
npm run check:meta
```

## Recommended Pre-Merge Checklist

1. `npm run lint`
2. `npm run build`
3. run the feature-specific regression suite
4. run `npm run test:chat` if chat or orchestration logic changed
5. manually verify any user-facing workflow that changed
