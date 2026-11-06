+++
title = "Build your own custom assistant"
summary = "A step-by-step build of a personal assistant (a custom GPT, Gem or Claude Project) with instructions, knowledge files and a test plan."
minutes = 12
+++

Let's build something real: a custom assistant that does one job for you, consistently. We'll use a running example, a **"Kind Complaints" assistant** that turns frustration into effective complaint letters, but you can swap in any job.

## Step 1: Choose one job

The best custom assistants do **one thing well**. Good candidates:

- "Turn my rough notes into a client update in my style."
- "Plan our family meals around our rules."
- "Explain my kid's homework without giving the answers."
- "Review my social posts against our brand guide."

## Step 2: Write the instructions

This is the heart of it. Use this structure:

```prompt
NAME: Kind Complaints

PURPOSE: Help me write effective, polite complaint letters that get results.

PROCESS:
1. Ask what happened, what I've already tried, and what outcome I want (refund, repair, apology, etc.).
2. Ask for key facts: dates, order numbers, amounts, names (remind me to remove anything I'm not comfortable sharing).
3. Identify my strongest points and any consumer rights that may apply where I live (tell me to verify these).
4. Draft a letter: clear summary, timeline, the specific outcome requested, a reasonable deadline.
5. Offer a shorter version for email or web forms.

TONE: Calm, firm, factual. Never rude or threatening.

FORMAT: Subject line, then letter. Under 300 words unless I ask for more.

WHEN UNSURE: Ask me rather than guessing. Never invent facts, laws or reference numbers.
```

## Step 3: Add knowledge (optional)

Upload reference files the assistant should use: your style guide, templates, past examples, price lists, policies. Keep files focused and current. Outdated documents produce outdated answers.

## Step 4: Create it in your app

The exact buttons change often, but the flow is the same:

- **ChatGPT:** Explore GPTs → Create. Paste the instructions; upload knowledge; choose capabilities.
- **Gemini:** Gems → New Gem. Paste instructions; add files if available.
- **Claude:** Create a Project, paste the instructions into the project instructions, and add files to its knowledge.

## Step 5: Test like a sceptic

Run at least five test cases, including awkward ones:

1. A normal, simple case.
2. A case with missing information (does it ask?).
3. A case where you're angry (does it stay calm?).
4. A request outside its job (does it handle it gracefully?).
5. A tricky edge case from real life.

Every time it misbehaves, **update the instructions** with a specific rule. ("If I give no order number, ask for one before drafting.") This loop is how good assistants are made.

> [!WARNING]
> If you share a custom assistant publicly, anyone using it may be able to see or extract its instructions and files. Don't put private information in shared assistants.

## Key takeaways

- One assistant, one job.
- Instructions = purpose, process, tone, format and what to do when unsure.
- Test with awkward cases and refine the instructions after every failure.
