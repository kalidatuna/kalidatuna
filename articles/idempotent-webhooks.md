# Idempotent Webhooks Without Duplicate Side Effects

Webhook consumers are easy to build when every request arrives once, in order, and the downstream API never fails. Production systems rarely behave that way.

A provider may retry the same event several times. Two deliveries may arrive at the same time. Your worker may update the CRM successfully and crash before it marks the job complete. A downstream API may time out after applying the change, leaving you unsure whether a retry is safe.

The practical goal is not "process every HTTP request once." That is usually impossible to guarantee end to end. The goal is to make repeated delivery produce the same business result.

This article shows a small design that works for common automation stacks such as Node.js services, n8n-style workflows, Make scenarios, and queue workers.

## 1. Give every business event a stable identity

Do not deduplicate on request time, payload hash alone, or a random ID you generate after receiving the webhook.

Prefer the provider's immutable event ID:

```json
{
  "id": "evt_01J8A8M7F6Y",
  "type": "customer.updated",
  "data": {
    "customer_id": "cus_123",
    "email": "new@example.com"
  }
}
```

The pair `provider + event_id` should be unique in your system.

A database table can enforce that rule:

```sql
create table webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);
```

The primary key is more reliable than checking first and inserting later. Two workers can pass a separate "does this exist?" check at the same time. A unique constraint makes the database decide which insert wins.

## 2. Acknowledge only after durable capture

A common failure looks like this:

1. receive webhook
2. return HTTP 200
3. start processing
4. process crashes

The provider believes the event was accepted, but you lost it.

Instead:

1. verify the request
2. insert the event into durable storage
3. return success
4. process asynchronously

For a small system, the database itself can be the queue.

```js
async function receiveWebhook(req, res) {
  const event = verifyAndParse(req);

  await db.query(
    `insert into webhook_events(provider, event_id, event_type, payload)
     values ($1, $2, $3, $4)
     on conflict (provider, event_id) do nothing`,
    ["stripe-like-provider", event.id, event.type, event]
  );

  res.status(200).send("ok");
}
```

A duplicate delivery becomes a harmless no-op at ingestion.

## 3. Separate event deduplication from side-effect deduplication

Storing each event once is necessary, but it does not completely solve duplicate side effects.

Imagine this sequence:

1. worker reads event
2. worker creates an invoice in an external accounting API
3. external API succeeds
4. worker crashes before updating `webhook_events.status`
5. worker retries
6. second invoice is created

The webhook itself was deduplicated. The business action was not.

Each non-reversible side effect should have its own stable operation key.

For example:

```text
accounting:invoice:create:order_8472
```

Store it:

```sql
create table operations (
  operation_key text primary key,
  state text not null,
  external_id text,
  updated_at timestamptz not null default now()
);
```

Before performing the side effect, claim the operation key. If the external API supports idempotency keys, send the same key there too.

```js
await accounting.createInvoice(invoice, {
  idempotencyKey: "accounting:invoice:create:order_8472"
});
```

This is stronger than relying on your local event status because it protects the exact business action.

## 4. Treat timeouts as "unknown," not "failed"

A timeout does not prove that the remote service rejected your request.

If you send "create invoice" and the connection dies after five seconds, three states are possible:

- the request never reached the provider
- the provider received it and failed
- the provider succeeded but your response was lost

Blind retrying is dangerous when the API does not support idempotency keys.

Use a recovery path:

```text
request times out
    |
    v
mark operation = unknown
    |
    v
query provider by stable business reference
    |
    +--> found      -> save external_id, mark complete
    |
    +--> not found  -> retry creation
```

For APIs without lookup support, use a unique reference you control whenever possible, such as an order number or client-generated ID.

## 5. Make retries selective

Do not retry every error.

A simple classification works well:

| Result | Action |
|---|---|
| 2xx | complete |
| 400 validation error | fail permanently |
| 401 or 403 | stop and alert |
| 404 for dependent resource | usually permanent or delayed dependency |
| 409 duplicate/conflict | inspect, often treat as success |
| 429 | retry with backoff |
| 5xx | retry with backoff |
| network timeout | reconcile, then retry if safe |

A retry schedule should spread requests out:

```js
const delays = [30, 120, 600, 1800, 7200]; // seconds
```

Add jitter in high-volume systems so many failed jobs do not retry at exactly the same second.

## 6. Keep the worker transaction small

Do not hold a database transaction open while calling a slow external API.

Instead, claim work quickly:

```sql
update webhook_events
set status = 'processing',
    attempts = attempts + 1
where provider = $1
  and event_id = $2
  and status in ('received', 'retry')
returning *;
```

Commit that change, perform the remote work, then write the result.

For multiple workers, use row locking or a lease:

```text
status = processing
lease_expires_at = now + 5 minutes
worker_id = worker-17
```

If the worker disappears, another worker can recover the event after the lease expires.

## 7. Design for replay from day one

A good webhook system can answer:

- What did we receive?
- What did we try?
- Which external object did we create?
- Why did a job fail?
- Can this event be replayed safely?

Keep the original payload. Keep attempt counts and errors. Keep external IDs.

Then a repair tool can replay a specific event without guessing:

```text
POST /internal/webhook-events/evt_01J8A8M7F6Y/replay
```

The replay path should use the same idempotency logic as normal processing.

## 8. Example: lead form to CRM and email

Consider a lead form automation:

```text
Form webhook
  -> normalize email
  -> upsert CRM contact
  -> create sales task
  -> send confirmation email
```

Useful operation keys could be:

```text
crm:contact:upsert:alice@example.com
crm:task:create:lead_9821
email:lead-confirmation:lead_9821
```

If the workflow crashes after the CRM update, the retry can safely skip or repeat the upsert, then continue with the missing task and email.

This pattern maps well to visual automation tools too. Store the event ID and operation keys in a lightweight database, Airtable-like table, Redis, or the target system itself when it supports unique external IDs.

## 9. Tests that catch the expensive bugs

The best tests are failure-sequence tests.

Test these cases:

1. Same event delivered twice sequentially.
2. Same event delivered twice concurrently.
3. Crash after remote success but before local completion.
4. Timeout after sending a remote request.
5. 429 followed by success.
6. Permanent 400 error.
7. Worker dies while holding a lease.
8. Manual replay after partial completion.

For the concurrent duplicate case, run two handlers against the same event ID and assert that the downstream operation appears once.

```js
await Promise.all([
  handle(event),
  handle(event)
]);

expect(await countInvoices("order_8472")).toBe(1);
```

## A practical rule

Exactly-once delivery is not the useful target. Exactly-once business effect is.

You get close to that by combining:

- durable event capture
- database uniqueness
- stable operation keys
- provider idempotency keys when available
- reconciliation after ambiguous failures
- bounded retries
- replayable state

That design is simple enough for a small integration and strong enough to prevent the duplicate invoices, duplicate emails, and duplicate CRM records that make automation unreliable.
