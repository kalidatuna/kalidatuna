# Articles

Technical writing about building automation that behaves well when things go wrong.

| Article | Summary |
| --- | --- |
| [Idempotent Webhooks Without Duplicate Side Effects](idempotent-webhooks.md) | A design for webhook consumers where repeated delivery produces the same business result: stable event identity, durable capture, side-effect keys, selective retries, and replay. |
| [Why webhook retries send duplicate emails, and how I make the workflow idempotent](idempotent-webhook-retries.md) | A shorter walkthrough of why a "processed" flag still races, and how claiming an event before the side effect fixes it. |

Runnable n8n versions of these ideas are in [workflows/n8n](../workflows/n8n/README.md).

[Return to my profile](../README.md)
