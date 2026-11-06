+++
title = "Your personal skills library"
summary = "Build a library of reusable skills and prompt templates, organised so you can find and improve them in seconds."
minutes = 10
+++

Power users don't write every prompt from scratch. They keep a **library**: a small, organised collection of their best prompts and skills that they refine over time. This is the AI equivalent of a chef's recipe book.

## What goes in the library

1. **Prompt templates:** fill-in-the-blank prompts for repeated tasks.
2. **Skills:** step-by-step procedures (with examples and checklists) for bigger tasks.
3. **Context snippets:** reusable blocks of background, like "About my business", "My writing style", "Our brand voice".

## The anatomy of a great skill

Whether you store it as a Claude Skill, a custom GPT, a saved note or a document, a strong skill contains:

```prompt
SKILL: Weekly family planner

WHEN TO USE: Every Sunday, to plan the week ahead.

INPUTS I'LL PROVIDE: calendar events, kids' activities, meals we fancy, any special tasks.

STEPS:
1. List fixed commitments by day.
2. Flag clashes and tight transitions (under 30 min).
3. Suggest who handles each pick-up/drop-off based on our rules: [rules].
4. Draft 5 dinners that fit busy nights (≤20 min on activity nights).
5. Produce a shopping list grouped by aisle.

OUTPUT: A day-by-day table, then the shopping list.

QUALITY CHECK: Every day has a dinner. No person is double-booked. Busy nights get quick meals.

EXAMPLE OUTPUT: [paste a past week you liked]
```

The **quality check** and **example** are what lift a skill from okay to reliable.

## How skills get loaded automatically

In apps that support skills (for example, Claude's Skills feature), each skill is saved as a small folder with a main instruction file. The assistant reads a short description of each skill and pulls in the full instructions only when your request matches. That's why the **"when to use"** line matters: it's how the assistant knows to reach for it.

In apps without skills, you get similar results with custom assistants, projects, or by pasting your saved skill text at the start of a chat.

## Organise your library

Keep it simple. A single document or notes folder works well:

- **Name** each entry clearly: *"Email: polite chase-up"*, *"Planning: weekly family"*.
- **Tag** by area: work, home, money, learning.
- **Version** your best ones: add a line "v3: added the clash check" when you improve them.
- **Prune** monthly: delete what you never use.

> [!TIP]
> Lumora's Prompt Library and bookmarks give you a head start. Save the prompts you like, then adapt them into your own versions.

## Let the AI write skills for you

After any conversation that went brilliantly:

```prompt
That worked really well. Turn this whole conversation into a reusable skill I can use again: include when to use it, the inputs I need to provide, the steps, the output format, a quality checklist and a short example.
```

## Key takeaways

- Keep a library of templates, skills and context snippets.
- Great skills include when to use, inputs, steps, output, quality check and an example.
- Let the AI convert successful conversations into reusable skills.
