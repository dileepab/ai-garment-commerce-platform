# Access Control

GarmentOS uses Auth.js credentials login with role-based page and action permissions.

## Roles

- `owner`
- `admin`
- `support`
- `operations`

## Permission Summary

### Owner

- Full access to all pages
- Full access to all brands
- Can edit settings and merchant configuration

### Admin

- Same application permissions as owner
- Full access to all brands unless custom user scoping is added later

### Support

- Can view orders
- Can view support inbox
- Can reply to support cases
- Cannot edit settings, products, production, operators, or analytics

### Operations

- Can view dashboard
- Can view and update orders
- Can view support inbox
- Can manage products, inventory, production, and operators
- Cannot edit merchant settings

## Brand Scoping

`owner` and `admin` default to all-brand access.

`support` and `operations` can be restricted to a subset of brands with:

```bash
SUPPORT_BRANDS="HappyBy,Cleopatra"
OPERATIONS_BRANDS="HappyBy,Cleopatra"
```

Or by using:

```bash
GARMENTOS_USERS='[{"email":"brand-support@garment.lk","password":"...","name":"Brand Support","role":"support","brands":["HappyBy"]}]'
```

When a user has limited brand access:

- dashboard data is scoped
- analytics data is scoped
- orders and support cases are scoped
- products and inventory actions are scoped

## Route Protection

Protected UI routes are enforced through Auth.js authorization callbacks and middleware-aware page permission checks.

Public routes that must stay accessible:

- `/api/webhooks/*`
- `/api/cron/*`
- auth endpoints needed for sign-in flow

If a signed-in user opens a page they do not have permission for:

- they are redirected to a default allowed area
- or sent to `/unauthorized`

## Operational Note

Brand scoping is a business filter, not just a visual preference. Any new server action or API route that reads or mutates brand-owned data should use the same scope checks as the current orders, support, analytics, and settings flows.
