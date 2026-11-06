+++
title = "School emails → family calendar"
summary = "AI reads school and club emails, pulls out dates and things to bring, and adds them to the family calendar."
difficulty = "Beginner"
minutes = 30
saves = "1 hour/week (and fewer forgotten PE kits)"
tools = ["Gmail", "Zapier or Make", "Google Calendar", "AI step"]
free = true
+++

School newsletters bury the important stuff ("non-uniform day Friday, bring £1") in paragraphs of news. This playbook extracts every date and to-do and puts it where your family will actually see it.

## Step 1: Label school emails

In Gmail, create a filter: emails from your school's and clubs' addresses get the label `school`.

## Step 2: Trigger

Zapier/Make: **Gmail → New labeled email** with label `school`.

## Step 3: AI extraction

```prompt
Read this school/club email and extract every event, deadline or thing to bring. Reply with JSON only:
{"items": [{"title": string, "date": "YYYY-MM-DD", "time": "HH:MM or null", "all_day": boolean, "child": string or null, "bring_or_do": string or null}]}
If there are no dated items, return {"items": []}. Today's date is {{today}}. Interpret relative dates like "next Friday" from today.
Email: {{body}}
```

## Step 4: Loop over items

Use a "Looping" (Zapier) or "Iterator" (Make) step to handle each item separately.

## Step 5: Create calendar events

Action: Google Calendar → *Create detailed event* in your shared family calendar.

- Title: `{{child}}: {{title}}`
- Description: `{{bring_or_do}}` plus a link to the original email
- Reminder: the evening before at 7pm (perfect for "bring a costume tomorrow")

## Step 6: Weekly overview (optional)

Every Sunday at 6pm, an AI step reads next week's family calendar and sends a short summary to the family group chat: "This week: Tuesday swimming kits, Thursday trip money due, Friday non-uniform (£1)."

## Test checklist

- [ ] An email with two dates creates two events
- [ ] "Next Wednesday" lands on the right date
- [ ] A newsletter with no dates creates nothing

> [!TIP]
> Not sure the AI got it right? Add a step that emails you a summary of what was added, with a link to each event, for the first couple of weeks.
