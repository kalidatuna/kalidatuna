+++
title = "Automatic receipt & spending tracker"
summary = "Forward a receipt email and AI logs the vendor, amount and category into a spreadsheet, with a monthly spending summary."
difficulty = "Beginner"
minutes = 30
saves = "1–2 hours/month"
tools = ["Gmail or Outlook", "Zapier or Make", "Google Sheets", "AI step"]
free = true
+++

Stop typing receipts into spreadsheets. With this playbook, you forward any receipt email to a special address (or label it), and it appears in your budget sheet, categorised, within a minute.

## What you'll build

**Trigger:** a receipt email arrives (forwarded or labelled) → **AI** extracts vendor, date, total and category → **Sheets** adds a row → **Monthly**, an AI summary of your spending lands in your inbox.

## Step 1: Prepare the spreadsheet

Create a Google Sheet called *Spending* with these headers in row 1:

`Date | Vendor | Total | Currency | Category | Source email | Logged at`

## Step 2: Set the trigger

In Zapier (or Make), create a new automation:

- **Trigger:** Gmail → *New labeled email*. Create a Gmail label called `receipts`. (Alternatively use Zapier's *Email by Zapier* inbox address and forward receipts to it.)
- Test by labelling a real receipt.

## Step 3: Add the AI extraction step

Add an AI action (e.g. *AI by Zapier* or an OpenAI/Anthropic action) with this prompt, mapping in the email body:

```prompt
Extract the following from this receipt email and reply with JSON only:
{"vendor": string, "date": "YYYY-MM-DD", "total": number, "currency": string, "category": one of ["groceries","transport","bills","eating out","household","shopping","other"]}
If a field is missing, use null. Email: {{body}}
```

If your tool supports *structured output*, define the same fields there; it's even more reliable.

## Step 4: Add the row

Action: Google Sheets → *Create Spreadsheet Row*. Map each JSON field to its column, plus the email subject and the current time.

## Step 5: The monthly summary

Create a second automation:

- **Trigger:** Schedule → monthly, 1st day, 8am.
- **Action:** Google Sheets → get rows from last month.
- **AI step:** "Summarise this spending by category, compare with the previous month if available, highlight the 3 biggest changes, and suggest one realistic saving. Under 150 words."
- **Action:** send yourself an email.

## Test checklist

- [ ] A grocery receipt lands in the right category
- [ ] A receipt in a different currency records the currency
- [ ] An email that isn't a receipt doesn't create a broken row (add a filter: only continue if `total` is not empty)

> [!TIP]
> Photo receipts? Snap them into a Google Drive folder and use "New file in folder" as a second trigger, with an AI step that reads images.

## Privacy note

Receipts can contain partial card numbers and addresses. The extraction prompt only keeps the fields you need. Don't log anything else.
