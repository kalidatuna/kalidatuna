+++
title = "Daily inbox digest"
summary = "Get one calm summary of what actually matters in your inbox every morning, with suggested replies."
difficulty = "Beginner"
minutes = 25
saves = "2–3 hours/week"
tools = ["Gmail or Outlook", "Zapier, Make or a scheduled AI task", "AI step"]
free = true
+++

Instead of checking email 40 times a day, get one digest each morning that tells you what needs you, and what doesn't.

## Two ways to build it

**Option A (simplest):** if your AI assistant can connect to your email and run scheduled tasks, you can set this up with a single prompt (see Step 4).

**Option B (most control):** an automation tool collects yesterday's emails and sends them through an AI step.

## Option B, step by step

### Step 1: Trigger

In Zapier or Make: **Schedule → Every weekday at 7:00am.**

### Step 2: Collect emails

Action: Gmail/Outlook → *Find emails* (or *Search emails*) with a query such as `newer_than:1d -category:promotions -category:social`. Limit to around 30 emails. Combine subject, sender and the first part of each body into one text block (most tools have a "formatter" or "aggregator" step for this).

### Step 3: Summarise with AI

```prompt
Here are the emails I received in the last 24 hours. Create my morning digest:
1. NEEDS ME TODAY: emails needing a reply or action today, with one-line summaries and a suggested 1–2 sentence reply each.
2. THIS WEEK: things to handle soon.
3. FYI: one line total summarising everything else.
Skip newsletters and promotions. Be concise; the whole digest should be readable in 2 minutes.

Emails: {{emails}}
```

### Step 4: Deliver it

Send the result to yourself by email, Slack, Telegram or a phone notification, wherever you'll read it first thing.

## Option A: the one-prompt version

In an assistant with email connected and scheduled tasks, schedule this for 7am on weekdays:

```prompt
Check my email from the last 24 hours. Give me: emails that need me today (with suggested replies), things for this week, and a one-line FYI for the rest. Ignore promotions. Keep it under 200 words.
```

## Make it great

- Add your VIP list: "Always put emails from [names] in NEEDS ME TODAY."
- Add context: "I'm a [role]; anything about [topics] is high priority."
- Review after a week. Is anything important getting missed? Adjust the query or prompt.

> [!WARNING]
> Keep this read-only. The digest suggests replies; you send them. Emails from strangers can contain hidden instructions aimed at AI, so don't let this workflow take actions automatically.
