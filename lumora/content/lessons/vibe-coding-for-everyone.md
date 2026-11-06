+++
title = "Vibe-coding: build small apps by describing them"
summary = "Create your own simple tools, calculators, trackers and websites by describing what you want, with no programming background needed."
minutes = 11
+++

"Vibe-coding" means building software by **describing what you want in plain English** while AI writes the code. You test it, say what's wrong, and repeat. It's how people with no programming experience are now building personal tools in an afternoon.

## What you can realistically build

- A **personal tracker:** habits, plants watered, books read, workouts
- A **calculator:** "how much paint do I need", quote estimator, recipe scaler
- A **simple website:** a page for your club, portfolio or small business
- A **mini-game or quiz** for your kids or classroom
- **Spreadsheet helpers:** scripts that tidy or reformat data

Many assistants can build and show small apps right in the chat (ChatGPT's canvas, Claude's artifacts, Gemini's canvas), and dedicated tools (like Lovable, Bolt, Replit and others) can build and host bigger projects.

## The vibe-coding loop

1. **Describe** what you want: who it's for, what it does, how it should look.
2. **Run** it and try it like a real user.
3. **Report** what's wrong or missing, specifically.
4. **Repeat** until it's right.

## A great first prompt

```prompt
Build a simple, mobile-friendly web app for tracking which houseplants I've watered.
- I can add plants with a name and how often they need water (in days).
- A home screen lists plants, sorted by who needs water soonest, with overdue ones highlighted in red.
- A big "Watered today" button on each plant.
- Data is saved in the browser so it's still there when I come back.
- Friendly design: soft green colours, rounded cards, large text.
Start with the simplest version that works.
```

## Giving good feedback

Vague: "It doesn't work."

Useful: "When I tap 'Watered today' on the fern, the date updates but the list doesn't re-sort until I refresh. Also make the add-plant button bigger on mobile."

If something breaks badly, say: "Go back to the previous working version, then try a different approach."

## Stay safe and sensible

- **Start small.** Get a tiny version working before adding features.
- **Personal tools are low-risk.** Apps that handle other people's data, payments or logins need real security expertise; get a professional review before going public.
- **Back up versions** you're happy with.
- **Don't paste secrets** (passwords, API keys) into prompts or into the code of anything you share.

> [!TIP]
> Can't think of an app? Ask: *"Based on my daily routine [describe], what are 5 tiny apps that would save me time or hassle?"*

## Key takeaways

- Vibe-coding = describe, run, report, repeat.
- Great for personal tools, calculators, simple sites and games.
- Start tiny, give specific feedback, and get expert help before handling others' data or money.
