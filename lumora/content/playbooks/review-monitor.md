+++
title = "Review monitor & response drafter"
summary = "Get alerted to new reviews, with sentiment, key issues and a ready-to-edit owner reply."
difficulty = "Intermediate"
minutes = 40
saves = "1–2 hours/week, plus faster replies"
tools = ["Google Business Profile or review platform", "Zapier or Make", "AI step", "Slack/email", "Google Sheets"]
free = false
+++

Fast, thoughtful replies to reviews build trust, and negative reviews need attention quickly. This playbook watches for new reviews and hands you a drafted response.

## Step 1: Trigger

Use your platform's integration in Zapier or Make (Google Business Profile, Trustpilot, Yelp and others have triggers like *New review*). If no integration exists, many review platforms can send email notifications; use *New email matching search* as the trigger instead.

## Step 2: Analyse with AI

```prompt
Analyse this customer review for [business]. Return JSON:
{"sentiment": "positive"|"mixed"|"negative", "rating": number or null, "topics": array of up to 3 short topics (e.g. "wait time", "staff friendliness"), "needs_owner_attention": boolean, "reply": an owner reply following the rules below}
Reply rules: if positive, thank them specifically and mention one detail they raised, under 50 words. If negative or mixed, acknowledge, apologise for their experience without admitting legal fault, and invite them to contact [contact] to make it right, under 80 words. Warm, human, never defensive.
Review: {{review_text}}
```

## Step 3: Alert and log

- If `needs_owner_attention` is true or sentiment is negative: send an instant Slack/email alert with the review, topics and draft reply.
- Always: log to a *Reviews* sheet with date, rating, sentiment, topics and reply.

## Step 4: Post the reply (you)

Copy the draft, adjust anything specific, and post it on the platform. Keep posting manual; replies are public and permanent.

## Step 5: Monthly themes

Monthly AI step over the sheet: "What are the top praised and criticised topics this month, how has sentiment changed, and what's one operational change that would most improve reviews?"

> [!TIP]
> Share the monthly summary with your team, including the praise. It's a great morale boost and makes improvements concrete.
