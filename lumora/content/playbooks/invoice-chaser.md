+++
title = "Polite invoice chaser"
summary = "Track unpaid invoices and send escalating, friendly reminders, drafted by AI and approved by you."
difficulty = "Intermediate"
minutes = 35
saves = "1–3 hours/month, and faster payment"
tools = ["Google Sheets or your accounting app", "Zapier or Make", "AI step", "Email"]
free = false
+++

Chasing payments is awkward and easy to postpone. This playbook keeps track and drafts the right reminder at the right time.

## Step 1: The invoice sheet

If your accounting tool (Xero, QuickBooks, FreshBooks, etc.) has a Zapier/Make integration, use its *overdue invoices* data directly. Otherwise create a sheet:

`Invoice # | Client | Contact email | Amount | Due date | Status | Reminders sent | Last reminder`

## Step 2: Daily check

Trigger: **Schedule → every weekday 9am.** Find rows where Status = `Unpaid` and due date has passed.

## Step 3: Pick the right tone

Use days overdue to choose a stage:

| Days overdue | Stage | Tone |
| --- | --- | --- |
| 1–6 | 1 | Friendly heads-up, assumes it slipped through |
| 7–20 | 2 | Polite but clear, asks for a payment date |
| 21+ | 3 | Firm and formal, mentions next steps per your terms |

Only send if the last reminder was 7+ days ago.

## Step 4: Draft with AI

```prompt
Write a stage {{stage}} payment reminder email for invoice {{invoice}} to {{client}} for {{amount}}, which was due on {{due_date}} ({{days}} days ago). Our payment details: [details]. Tone for stage 1: friendly, assumes an oversight. Stage 2: polite, clear, asks them to confirm a payment date. Stage 3: firm and professional, referencing our payment terms [terms], no threats. Under 120 words. Subject line first.
```

## Step 5: Approve and send

Create a **draft** in your email (or send yourself the text for review). Once you're comfortable, stage 1 reminders are often safe to send automatically; keep stages 2–3 manual.

## Step 6: Update the sheet

Increment *Reminders sent* and set *Last reminder* to today. When a payment arrives, mark the row `Paid` (or let your accounting integration do it).

> [!TIP]
> Add a polite "If you've already paid, thank you, and please ignore this" line to stage 1. It keeps relationships warm.
