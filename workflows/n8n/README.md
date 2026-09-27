# n8n automation samples

These are small, credential-free workflow samples for showing implementation style. They are demos, not claims of client deployment.

## 1. Retry-safe lead intake

File: `lead-intake-retry-safe.json`

Flow:

`Webhook -> normalize fields -> build stable operation key -> suppress duplicate delivery -> prepare CRM upsert/follow-up payload -> respond`

Example request after importing and activating the workflow:

```bash
curl -X POST http://localhost:5678/webhook/demo-lead-intake \
  -H 'content-type: application/json' \
  -d '{"lead_id":"lead_42","email":"Alice@Example.com","name":"Alice","company":"Acme","source":"landing-page"}'
```

Send the same event twice. The first response reports `status: accepted`; the next reports `status: duplicate`.

## 2. Idempotent payment event

File: `payment-event-idempotent.json`

Flow:

`Webhook -> validate event -> dedupe by provider event ID -> prepare accounting update -> prepare stable receipt idempotency key -> respond`

Example:

```bash
curl -X POST http://localhost:5678/webhook/demo-payment-event \
  -H 'content-type: application/json' \
  -d '{"event_id":"evt_1001","invoice_id":"inv_77","status":"paid","amount":12500,"currency":"USD","customer_email":"alice@example.com"}'
```

## Production note

The demos use n8n workflow static data so they can run without external credentials. For real concurrent production workloads, replace that demo state with durable storage that enforces a unique key, such as PostgreSQL, Redis with an atomic claim, or a CRM/database field with a uniqueness constraint. Downstream APIs should receive their own stable idempotency keys when they support them.

The design rationale is described in [Idempotent Webhooks Without Duplicate Side Effects](../articles/idempotent-webhooks.md).
