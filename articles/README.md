# Articles

Technical writing on building automations that behave correctly under retries.

| Article | Summary |
| --- | --- |
| [Idempotent Webhooks Without Duplicate Side Effects](idempotent-webhooks.md) | A design guide: stable event identity, durable capture, operation keys, selective retries, and replay. |
| [Why webhook retries send duplicate emails](idempotent-webhook-retries.md) | A small reproduction (50 sends vs. 10) and the claim-before-side-effect pattern that fixes it. |

The runnable n8n samples that apply these ideas are in [workflows/n8n](../workflows/n8n/README.md).

[Return to my profile](../README.md)
