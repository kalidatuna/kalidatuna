+++
title = "Build your first automation"
summary = "A guided build: new form response → AI summary → spreadsheet row → notification. Works in Zapier, Make or n8n."
minutes = 12
+++

Let's build a genuinely useful automation from scratch. Our example: **an enquiry handler** for anyone who receives requests through a form: a tutor, a cleaner, a photographer, a club organiser.

**What it does:** when someone fills in your contact form → AI summarises the request and rates urgency → a row is added to a spreadsheet → you get a short notification.

## What you'll need

- A form tool (Google Forms, Typeform, Tally, Jotform or your website form).
- A spreadsheet (Google Sheets or Excel online).
- An automation tool account (Zapier, Make or n8n; free tiers are fine to start).
- Optional: an AI connection (most automation tools include an AI step; some need an API key from an AI provider).

## Step 1: Set the trigger

In your automation tool, create a new automation (Zapier calls it a *Zap*, Make a *Scenario*, n8n a *Workflow*).

- Choose your form app as the **trigger**.
- Event: *New response* / *New submission*.
- Connect your account and pick your form.
- **Test** it: submit a sample response so the tool has real data to work with.

## Step 2: Add the AI step

Add an action using the tool's built-in AI (or an AI provider integration). Give it a clear instruction and map in the form fields:

```prompt
You process customer enquiries for a small business. Read the enquiry below and respond ONLY with these lines:
SUMMARY: one sentence
SERVICE: which service they want, or "unclear"
URGENCY: high, medium or low (high = needs reply today)
SUGGESTED_REPLY: a friendly 2–3 sentence reply

Enquiry from {{name}}: {{message}}
```

The fixed labels make the output predictable, which matters for the next step. Many tools can also split AI output into separate fields automatically ("structured output").

## Step 3: Add a spreadsheet row

- Action: Google Sheets → *Create spreadsheet row*.
- Create column headers first: Date, Name, Email, Summary, Service, Urgency, Suggested reply, Status.
- Map each column to the form fields and AI output fields.

## Step 4: Notify yourself

Add a final action: email, Slack, Telegram or a phone notification.

> New enquiry from {{name}} ({{urgency}}): {{summary}}

**Bonus:** add a *filter* or *router* so only **high** urgency enquiries trigger an instant notification, and the rest go into a daily digest.

## Step 5: Test, then switch on

Submit 3–4 test enquiries, including a vague one and an urgent one. Check that each step worked, then turn the automation on.

> [!WARNING]
> Notice that the AI **suggests** a reply but doesn't send it. Keep a human approval step for anything customer-facing until you've watched the automation work well for a few weeks.

## Key takeaways

- Trigger → AI step → spreadsheet → notification is a pattern you can reuse everywhere.
- Ask the AI step for fixed labels or structured output so later steps are reliable.
- Test with awkward examples, and keep humans in the loop for anything sent to customers.
