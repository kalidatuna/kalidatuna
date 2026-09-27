# Synthetic n8n WhatsApp lead-routing proof

This is a small architecture example for evaluating automation work. It is synthetic and is not presented as a client deployment.

## Goal

Take an inbound WhatsApp lead event, normalize it, prevent duplicate processing, classify the request, route high-intent or ambiguous leads to a human, and leave a clear audit trail.

## Workflow

1. **Webhook**
   - Receive the provider event.
   - Reject missing message IDs or sender IDs.

2. **Normalize**
   - Convert provider-specific fields into a stable internal shape:
     `message_id`, `sender_id`, `text`, `received_at`, `source`.

3. **Idempotency check**
   - Build a key such as `whatsapp:<message_id>`.
   - Check the CRM or datastore before any side effect.
   - A repeated webhook returns success without creating a second lead or reply.

4. **Qualification**
   - Extract only the fields needed for routing.
   - Example outcomes: `sales_ready`, `needs_human`, `support`, `unknown`.
   - Missing or low-confidence information goes to `needs_human`.

5. **Route**
   - `sales_ready`: create or update the CRM lead, then prepare an approved response.
   - `needs_human`: create a review task with the original message and normalized fields.
   - `support`: route to the support queue.
   - `unknown`: log and request clarification.

6. **Audit**
   - Store message ID, route, timestamps, workflow version, and side-effect IDs.
   - Never store secrets in workflow logs.

7. **Error path**
   - Retry transient provider or CRM failures.
   - Keep the same idempotency key across retries.
   - Send permanent failures to a review queue instead of silently dropping them.

## Example normalized payload

```json
{
  "message_id": "wamid.example-123",
  "sender_id": "15550001111",
  "text": "Can someone quote this for next week?",
  "received_at": "2026-09-27T00:00:00Z",
  "source": "whatsapp"
}
```

## Example Code-node normalization

```js
const body = $json.body ?? $json;

const messageId =
  body.message_id ??
  body.messages?.[0]?.id ??
  body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;

const senderId =
  body.sender_id ??
  body.messages?.[0]?.from ??
  body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

const text =
  body.text ??
  body.messages?.[0]?.text?.body ??
  body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ??
  "";

if (!messageId || !senderId) {
  throw new Error("Missing stable WhatsApp message or sender identifier");
}

return [{
  json: {
    message_id: String(messageId),
    sender_id: String(senderId),
    text: String(text).trim(),
    received_at: new Date().toISOString(),
    source: "whatsapp",
    idempotency_key: `whatsapp:${messageId}`
  }
}];
```

## Acceptance checks for a paid test

- A valid event produces one normalized lead record.
- Replaying the same message ID does not create a duplicate.
- Missing stable identifiers fail before CRM or messaging side effects.
- Ambiguous or low-confidence messages go to human review.
- Transient failures can retry without duplicating side effects.
- The delivered workflow includes an export plus short handoff notes describing credentials, environment variables, and retry behavior.

For an actual client build, provider payloads, credentials, CRM fields, approved message templates, and retention rules would be confirmed before implementation.
