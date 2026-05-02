# Fulfillment Workflow

GarmentOS supports post-confirmation order operations from packing through delivery and returns.

## Typical Status Flow

- `pending`
- `confirmed`
- `packing`
- `ready_to_ship`
- `shipped`
- `out_for_delivery`
- `delivered`

Possible exception states:

- `delivery_failed`
- `returned`
- `cancelled`

## Fulfillment Data Stored On Orders

- courier
- tracking number
- failure reason
- return reason

## Fulfillment Event History

Each status transition can be stored in `OrderFulfillmentEvent` with:

- previous status
- new status
- note
- tracking number
- courier
- actor details
- whether the customer was notified

## Operational Rules

- cancellation is only safe before later fulfillment stages
- risky changes should stop once an order is already shipped
- customer-facing notifications should not duplicate previous updates
- support handoff rules still apply when communication safety matters

## Recommended Admin Usage

1. confirm the order
2. move to packing
3. attach courier and tracking when ready
4. mark shipped
5. update delivery outcome
6. record failure or return reasons when needed

## Customer Experience

Customers can ask about order status and shipping progress through chat. If tracking or courier data exists, the assistant should prefer that over generic delivery estimates.
