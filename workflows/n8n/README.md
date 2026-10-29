# n8n automation samples

These are small, credential-free workflow samples for showing implementation style. They are demos, not claims of client deployment.

## Import a sample

1. Start n8n locally, for example with `npx n8n` or the official Docker image.
2. In the editor, create a workflow and choose **Import from File**.
3. Select one of the JSON files in this folder.
4. Activate the workflow so its production webhook URL (`/webhook/...`) is registered.

No credentials are required. Each workflow keeps its demo state in workflow static data.

## 1. Retry-safe lead intake

File: `lead-intake-retry-safe.json`

Flow:

`Webhook -> normalize fields -> build stable operation key -> suppress duplicate delivery -> prepare CRM upsert/follow-up payload -> respond`

Example request after importing and activating the workflow, run from this folder ([payload](payloads/lead.json)):

```bash
curl -X POST http://localhost:5678/webhook/demo-lead-intake \
  -H 'content-type: application/json' \
  -d @payloads/lead.json
```

Send the same event twice. The first response reports `status: accepted`; the next reports `status: duplicate`.

## 2. Idempotent payment event

File: `payment-event-idempotent.json`

Flow:

`Webhook -> validate event -> dedupe by provider event ID -> prepare accounting update -> prepare stable receipt idempotency key -> respond`

Example, run from this folder ([payload](payloads/payment-paid.json)):

```bash
curl -X POST http://localhost:5678/webhook/demo-payment-event \
  -H 'content-type: application/json' \
  -d @payloads/payment-paid.json
```

## Production note

The demos use n8n workflow static data so they can run without external credentials. For real concurrent production workloads, replace that demo state with durable storage that enforces a unique key, such as PostgreSQL, Redis with an atomic claim, or a CRM/database field with a uniqueness constraint. Downstream APIs should receive their own stable idempotency keys when they support them.

The design rationale is described in [Idempotent Webhooks Without Duplicate Side Effects](../../articles/idempotent-webhooks.md).
