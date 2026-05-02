# Customer Chat Capabilities

GarmentOS uses the same orchestration pipeline for Messenger and Instagram DM.

## What The Assistant Can Do

- answer product availability questions
- share size-chart guidance
- collect name, address, and phone details
- confirm new orders
- update allowed draft or pre-shipment details
- explain delivery charges and timing
- check order status
- support safe self-service actions
- hand customers to human support when needed

## Safe Self-Service

The customer-facing assistant can help with:

- order status lookup
- pre-shipment address or phone updates when allowed
- eligible cancellations
- reorders of previous items
- shipping/tracking updates when data exists

## Things That Should Escalate

- risky edits after shipment
- unclear or conflicting requests
- repeated AI failures
- support-sensitive cases already locked to a human
- anything outside configured business rules

## Tone And Behavior

The assistant should:

- mirror the customer’s language when possible
- stay short and clear
- avoid repeating full summaries unnecessarily
- ask only for missing information
- avoid pretending certainty when a human is needed

## Human Support Handoff

When a support case is active:

- the bot should stop autonomous replies
- the customer is directed to configured support contact details or kept in chat for manual follow-up
- normal automation resumes only after the support case is resolved
