+++
title = "AI inside your workflows"
summary = "Six AI building blocks (summarise, classify, extract, draft, translate, decide) and how to make them reliable."
minutes = 10
+++

Once you've built one automation, you'll start seeing opportunities everywhere. This lesson gives you the **six AI building blocks** that cover the majority of useful AI automations, plus the techniques that keep them dependable.

## The six building blocks

| Block | What it does | Example |
| --- | --- | --- |
| **Summarise** | Long → short | Daily digest of newsletters |
| **Classify** | Put things in buckets | Tag support emails as billing / technical / feedback |
| **Extract** | Pull specific facts out | Get amount, date and vendor from a receipt |
| **Draft** | Write a first version | Suggested reply to every enquiry |
| **Translate** | Language or tone | Translate reviews; make notes more formal |
| **Decide (with rules)** | Choose a path | Route urgent issues to your phone, others to a digest |

Most real automations chain 2–3 blocks: *extract → classify → draft*.

## Make AI steps reliable

**1. Fixed choices for classification.** Don't ask "what category is this?" Ask "choose exactly one of: billing, technical, feedback, other".

**2. Structured output for extraction.** Ask for specific fields, ideally as JSON, which automation tools can map automatically:

```prompt
Extract the following from this receipt text and reply with JSON only:
{"vendor": string, "date": "YYYY-MM-DD", "total": number, "currency": string, "category": one of ["groceries","transport","bills","eating out","other"]}
If a field is missing, use null. Receipt: {{text}}
```

**3. Give an escape hatch.** "If you're not sure, use 'other' / 'needs review'." This stops the AI from guessing confidently.

**4. Keep instructions short and specific.** Long, rambling instructions produce inconsistent results.

**5. Log everything.** Write each AI result to a spreadsheet so you can spot mistakes and improve the prompt.

## Real-life recipes

- **Receipt tracker:** forward receipts to an email → extract fields → add to budget sheet → monthly AI summary of spending.
- **Review monitor:** new Google review → classify sentiment → if negative, alert you instantly with a suggested response.
- **Content repurposer:** new blog post → AI drafts a newsletter blurb, 3 social posts and a short video script → saved as drafts for you to approve.
- **Family admin:** school emails → extract dates and things to bring → add to the family calendar.

> [!TIP]
> Costs: AI steps use credits or API usage. Summarising a few emails a day costs pennies, but check your plan's limits before processing thousands of items.

## When AI is the wrong tool

If a simple rule works ("if the subject contains *invoice*"), use the rule. It's faster, free and never hallucinates. Use AI where judgement or language is involved.

## Key takeaways

- Six blocks: summarise, classify, extract, draft, translate, decide.
- Reliability comes from fixed choices, structured output, escape hatches and logging.
- Use plain rules where rules work; use AI where language and judgement are needed.
