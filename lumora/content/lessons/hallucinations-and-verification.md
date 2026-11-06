+++
title = "Hallucinations and how to catch them"
summary = "Why AI makes things up, where it's most likely to happen, and a fast verification routine for anything that matters."
minutes = 8
free = true
+++

An AI "hallucination" is when an assistant states something false as if it were true: an invented statistic, a book that doesn't exist, a wrong date, a fake legal case. It's not lying; it's predicting plausible text. But the effect is the same, so you need a routine.

## Where hallucinations hide

| High risk | Lower risk |
| --- | --- |
| Specific numbers, statistics, dates | General explanations of well-known topics |
| Quotes and who said them | Rewriting or summarising text *you* provided |
| Citations, links, book and paper titles | Brainstorming and ideas |
| Niche or very recent topics | Formatting and restructuring |
| Laws, medical dosages, technical specs | Tone and style changes |

The pattern: **the more specific and checkable the claim, the more you should check it.**

## The 60-second verification routine

1. **Spot the claims that matter.** Which facts would cause a problem if wrong?
2. **Ask the AI to flag its uncertainty:**

```prompt
List every factual claim in your last answer. For each one, rate your confidence (high/medium/low) and say how I could verify it.
```

3. **Check the important ones** against a reliable source: official websites, reputable publications, the original document.
4. **Use grounded modes:** web search, deep research, or uploading the source document so the AI answers *from* it.

## Reduce hallucinations at the source

- **Give it the source.** "Answer using only this document" is far more reliable than asking from memory.
- **Allow "I don't know".** Add: "If you're not sure, say so. Don't guess."
- **Ask for quotes.** "Quote the exact sentence from the document that supports each point."
- **Use the right mode.** Reasoning and research modes are generally more careful for complex factual work.

> [!WARNING]
> Professionals have been embarrassed, and in some cases sanctioned, for submitting AI-written work containing fabricated citations. If your name is on it, verify it.

## Confident ≠ correct

AI sounds equally sure whether it's right or wrong. Train yourself to judge claims by **how checkable and important they are**, not by how confident they sound.

## Try it now

Ask your assistant about a topic you know very well: your job, your hometown, your hobby. Look for small errors. Seeing hallucinations in an area you know is the best inoculation for areas you don't.

## Key takeaways

- Hallucinations cluster in specific facts, quotes, citations, niche and recent topics.
- Ask for confidence ratings, check what matters, and use grounded modes.
- Give the AI your sources and permission to say "I don't know".
