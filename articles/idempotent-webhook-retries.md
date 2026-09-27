# Why webhook retries send duplicate emails, and how I make the workflow idempotent

I like automations that fail loudly. A failed step is visible. A duplicate side effect is worse because the workflow may look healthy while customers get two welcome emails, two invoices, or two CRM records.

The bug usually starts with a reasonable assumption: a webhook arrives once.

That assumption is unsafe.

Webhook providers retry. Queues redeliver. HTTP clients time out after the server already accepted a request. Workers crash between two writes. Someone presses "retry" in an automation tool. If the workflow has a side effect and no idempotency boundary, every retry can perform the side effect again.

I built a small reproduction to make the failure obvious. I created 10 unique lead events and delivered the same set five times, simulating retries.

The naive handler sent 50 emails. The idempotent handler sent 10.

```python
events = [
    {"event_id": f"lead-{i}", "email": f"user{i}@example.com"}
    for i in range(10)
]

delivery_stream = events * 5

# Naive workflow
naive_sends = []
for event in delivery_stream:
    naive_sends.append(event["email"])

print(len(naive_sends))  # 50

# Idempotent workflow
processed = set()
safe_sends = []

for event in delivery_stream:
    if event["event_id"] in processed:
        continue

    processed.add(event["event_id"])
    safe_sends.append(event["email"])

print(len(safe_sends))  # 10
```

The set is enough for a toy test. It is not enough for a real workflow.

The hard part is deciding where the idempotency boundary lives and making the decision atomic.

## The common fix that still races

A lot of Make, n8n, Zapier, and custom webhook flows use this pattern:

1. Look up the event ID in a database.
2. If it does not exist, send the email.
3. Insert the event ID into the database.

That looks correct until two workers process the same event at the same time.

Both workers can complete step 1 before either one reaches step 3. Both see "not found." Both send the email. The database may reject the second insert, but the duplicate email already happened.

The check and the claim need to be one atomic operation.

## I claim the event before doing the side effect

For a database-backed workflow, I prefer a unique key that represents the exact action I am about to perform.

For example:

```text
idempotency_key = "hubspot-contact-created:evt_12345:send-welcome-email-v1"
```

Then I try to insert that key into a table with a unique constraint.

```sql
CREATE TABLE workflow_claims (
  idempotency_key TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

The worker attempts:

```sql
INSERT INTO workflow_claims (idempotency_key, state)
VALUES ('hubspot-contact-created:evt_12345:send-welcome-email-v1', 'claimed');
```

If the insert succeeds, this worker owns the action.

If the insert fails because the key already exists, the workflow stops before sending anything.

This is much safer than "search first, then insert" because the database resolves the race.

In Postgres, I would usually express the same idea with `INSERT ... ON CONFLICT DO NOTHING` and check whether the insert actually created a row.

## A boolean "processed" flag is too weak

There is another failure window after the claim.

Imagine this order:

1. Claim event.
2. Call email provider.
3. Process crashes before recording success.

On retry, the claim already exists. If the workflow treats "claim exists" as "email definitely sent," it may suppress a message that never went out.

Now reverse the order:

1. Call email provider.
2. Record claim.

If the provider accepts the email but the process crashes before step 2, the retry sends a duplicate.

There is no magic ordering that removes this uncertainty when the external provider and your database are separate systems.

I use explicit states instead:

```text
claimed
effect_requested
effect_confirmed
failed
```

The workflow can then distinguish "this action was definitely confirmed" from "we started it and lost certainty."

That uncertainty matters.

## The provider request ID should be stored

When an email, payment, CRM, or messaging API returns its own request ID, I store it with the workflow claim.

For example:

```text
idempotency_key: hubspot-contact-created:evt_12345:send-welcome-email-v1
state: effect_confirmed
provider_request_id: msg_8f2a...
```

If the HTTP connection times out, I do not immediately assume failure.

A timeout means I do not know whether the provider accepted the request.

If the provider offers a lookup endpoint, I reconcile using the idempotency key or request ID before retrying the side effect.

This is the difference between "retry on error" and "retry safely."

## The idempotency key should describe intent

I avoid hashing the entire payload unless I have a strong reason.

Payloads often contain timestamps, formatting changes, reordered fields, or metadata that can change while the business action stays the same.

I prefer a key built from stable business identifiers:

```text
source_event_id + action_name + action_version
```

Examples:

```text
stripe:evt_abc:grant-plan-access:v1
typeform:resp_123:create-crm-contact:v1
shopify:order_456:send-fulfillment-email:v2
```

The version is useful when the meaning of the action changes. I can intentionally allow a new behavior without pretending it is the same side effect.

## Automation tools still need a durable store

This problem is not limited to code.

In n8n or Make, I would use the same design with a durable store:

1. Receive webhook.
2. Derive stable idempotency key.
3. Atomically create the claim in Postgres, Redis with the right command, or another store with unique-write semantics.
4. Stop if the claim already exists and is confirmed.
5. Perform the external action.
6. Save provider request ID and final state.
7. Route ambiguous failures to reconciliation instead of blind retry.

A spreadsheet can work for a demo. I would not use it as the concurrency boundary for a workflow that can create money movement, customer messages, or duplicate records.

## What I test before calling the workflow done

I do not stop after one successful run.

For a side-effecting automation, I test at least these cases:

- The same event delivered many times.
- Two workers processing the same event concurrently.
- The external API returning 500.
- The external API timing out after a request may have been accepted.
- The worker crashing after claim creation.
- The worker crashing after the provider responds but before local confirmation.
- A manual retry from the automation dashboard.
- A new action version using the same source event.

The goal is not "the happy path works."

The goal is that retries change the result only when I intend them to.

For this reproduction, five deliveries of each of 10 unique events produced 50 side effects in the naive handler and 10 in the idempotent handler. That tiny test captures the core failure mode. The production design is about preserving that property when concurrency, crashes, and external APIs make the timing messy.
