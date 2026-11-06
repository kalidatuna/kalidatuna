+++
title = "Meeting notes pipeline"
summary = "Recorded meetings become summaries, action items in your task manager, and a follow-up email draft, automatically."
difficulty = "Intermediate"
minutes = 40
saves = "2–4 hours/week"
tools = ["Zoom/Meet/Teams or a note-taker app", "Zapier or Make", "AI step", "Task manager (Todoist, Asana, Trello)", "Email"]
free = false
+++

Never write meeting minutes again. When a transcript is ready, AI extracts decisions and actions, creates tasks, and drafts the follow-up.

> [!NOTE]
> Always tell participants a meeting is being recorded or transcribed, and follow your organisation's policies on recordings and AI tools.

## Step 1: Get transcripts automatically

Most platforms and note-takers (Zoom, Google Meet, Teams, Otter, Fireflies and similar) can save transcripts automatically. Pick one where your automation tool has a *New transcript* / *New recording* trigger, or that saves transcripts to a Drive folder you can watch.

## Step 2: Extract with AI

```prompt
From this meeting transcript, return JSON:
{"title": string, "summary": 3 sentences, "decisions": array of strings, "actions": [{"task": string, "owner": string or "unassigned", "due": "YYYY-MM-DD" or null}], "open_questions": array of strings, "follow_up_email": a short email to attendees summarising decisions and actions}
Only include things actually said. If unsure about an owner or date, use "unassigned"/null rather than guessing.
Transcript: {{transcript}}
```

## Step 3: Create tasks

Loop over `actions` and create a task in your task manager for items where the owner is you (or for everyone, if it's a shared team board). Include a link back to the transcript.

## Step 4: Save the notes

Append the summary, decisions and open questions to a *Meeting notes* doc or Notion database, with the date and attendees.

## Step 5: Draft the follow-up

Create an email **draft** (not a sent email) to attendees with the follow-up text. Review and send it yourself within the hour, while the meeting is fresh.

## Weekly bonus

Every Friday: an AI step reads the week's meeting notes and open tasks and answers, "What did I commit to this week, what's overdue, and what decisions are still waiting on someone?"

## Test checklist

- [ ] A meeting with no actions creates no tasks
- [ ] "Sam will send the deck by Thursday" becomes a task with owner and date
- [ ] The email draft contains nothing that wasn't said
