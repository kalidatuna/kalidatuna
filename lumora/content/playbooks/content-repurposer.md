+++
title = "One post → everywhere content repurposer"
summary = "Publish once; AI drafts your newsletter blurb, social posts and video script, saved as drafts for approval."
difficulty = "Intermediate"
minutes = 45
saves = "3–5 hours/week"
tools = ["Blog/RSS or Google Docs", "Make or Zapier", "AI step", "Google Docs or Notion", "Social scheduler"]
free = false
+++

Create one strong piece of content each week and let AI adapt it for every channel, in your brand voice, waiting for your approval.

## Step 1: Your brand voice block

Write (or generate with the *Brand voice guide* prompt) a short block you'll reuse in every AI step:

> Voice: warm, practical, lightly funny. Short sentences. Avoid: "game-changer", "unlock", "delve", hashtags in the middle of sentences. Audience: [who].

## Step 2: Trigger

- **Blog:** RSS → *New item in feed*.
- **No blog?** Google Docs → *New document in folder* called `Source content`.

## Step 3: Generate the pack

One AI step with a clear structure:

```prompt
[brand voice block]
Here's our new piece of content: {{title}} {{content}}
Create:
1. NEWSLETTER: a 120-word section with a link placeholder [LINK]
2. LINKEDIN: story → insight → question, under 180 words
3. INSTAGRAM: hook first line, under 120 words, 5 relevant hashtags at the end
4. X/THREADS: 3 standalone short posts
5. VIDEO: a 45-second script with hook, 3 beats and a call to action
Use only facts from the source content. Label each section clearly.
```

## Step 4: Save as drafts

Create a Google Doc (or Notion page) titled `Content pack: {{title}}` with the AI output, and notify yourself.

## Step 5: Approve and schedule

Edit the pack (aim for 10 minutes), then paste into your social scheduler (Buffer, Later, Metricool or the platforms' own schedulers). Optionally, once you trust the pipeline, send approved sections to the scheduler as drafts via its integration.

## Step 6: Learn what works

Every month, paste your best and worst performing posts into an AI chat: "What patterns do the top performers share? Update my voice block with 3 new guidelines."

> [!WARNING]
> Don't auto-publish. Platforms penalise low-quality automated posting, and one hallucinated claim on your brand account is costly. Draft automatically, publish deliberately.
