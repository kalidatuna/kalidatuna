+++
title = "Smart enquiry handler for small businesses"
summary = "New form enquiries are summarised, rated for urgency, logged and answered with a suggested reply for you to approve."
difficulty = "Intermediate"
minutes = 45
saves = "3–6 hours/week"
tools = ["Website form or Google Forms", "Zapier or Make", "Google Sheets", "AI step", "Email/Slack"]
free = false
+++

The full build from the Automation module, extended into a production-ready setup with approval, a daily digest and a lightweight CRM.

## Architecture

**Form submission** → **AI** (summary, service, urgency, suggested reply as structured output) → **Sheets** (your mini-CRM) → **Router**: high urgency → instant phone alert; others → daily digest → **You approve** → reply sent from your email.

## Step 1: Your mini-CRM sheet

Headers: `Received | Name | Email | Phone | Message | Summary | Service | Urgency | Suggested reply | Status | Replied at`

Status values: `New`, `Approved`, `Sent`, `Closed`.

## Step 2: Trigger and AI step

Trigger: your form's *New submission*. Then an AI step with structured output:

```prompt
You triage enquiries for [business], which offers [services]. Using ONLY the business info below, return JSON:
{"summary": one sentence, "service": one of [list of services] or "unclear", "urgency": "high"|"medium"|"low", "suggested_reply": a friendly reply under 90 words that answers what you can from the business info and proposes a next step}
High urgency = wants service within 48 hours or mentions a problem in progress.
Never invent prices, availability or promises not in the business info.
Business info: [prices, areas served, hours, booking link, FAQs]
Enquiry from {{name}}: {{message}}
```

## Step 3: Log it

Sheets → *Create row* with all fields, Status = `New`.

## Step 4: Route by urgency

Add a router/paths step:

- **High:** send a push notification or SMS: "🔥 {{name}}: {{summary}}".
- **Medium/low:** no instant alert. A separate 5pm scheduled automation emails you all `New` rows as a digest.

## Step 5: One-click approval

The simplest reliable approach: when you change Status to `Approved` in the sheet (edit the suggested reply first if needed), a second automation triggers on *Updated row*, sends the reply from your email, and sets Status to `Sent` with a timestamp.

## Step 6: Monthly insights

On the 1st of each month, an AI step reads last month's rows: "What are the most common requests, what share were urgent, which services are most requested, and what FAQ should I add to my website?"

> [!WARNING]
> Keep humans in charge of prices, availability and anything contractual. Review the suggested replies for at least the first month before considering any automatic sending, and even then only for simple acknowledgements.

## Test checklist

- [ ] Vague enquiry gets "unclear" and a clarifying question
- [ ] Urgent enquiry triggers the instant alert
- [ ] Approving a row sends exactly one email
- [ ] Nothing in a reply contradicts your business info
