# n8n automation samples

These are small, credential-free workflow samples for showing implementation style. They are demos, not claims of client deployment.

## Importing a sample

1. In n8n, open **Workflows → Import from File** and choose one of the `.json` files in this folder.
2. Save the workflow and toggle it to **Active** so the production webhook URL is registered.
3. Send a request with `curl` as shown below. Test webhook URLs use `/webhook-test/` instead of `/webhook/`.

No credentials are required; state is kept in workflow static data.

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

The same payload is available as [`samples/lead.json`](samples/lead.json):

```bash
curl -X POST http://localhost:5678/webhook/demo-lead-intake \
  -H 'content-type: application/json' \
  --data @samples/lead.json
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

Or send [`samples/payment-paid.json`](samples/payment-paid.json) with `--data @samples/payment-paid.json`.

Expected behaviour:

| Request | Response |
| --- | --- |
| First delivery of `evt_1001` | `ok: true`, `duplicate: false`, plus `accountingUpdate` and a `receiptRequest` keyed `receipt:inv_77` |
| Repeat delivery of `evt_1001` | `ok: true`, `duplicate: true`, with the original `firstProcessedAt` timestamp |
| [`samples/payment-invalid.json`](samples/payment-invalid.json) (no `invoice_id`) | `ok: false`, `status: invalid` |

A `receiptRequest` is only prepared when `status` is `paid`.

## Production note

The demos use n8n workflow static data so they can run without external credentials. For real concurrent production workloads, replace that demo state with durable storage that enforces a unique key, such as PostgreSQL, Redis with an atomic claim, or a CRM/database field with a uniqueness constraint. Downstream APIs should receive their own stable idempotency keys when they support them.

The design rationale is described in [Idempotent Webhooks Without Duplicate Side Effects](../../articles/idempotent-webhooks.md).
