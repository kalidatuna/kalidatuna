+++
title = "Your personal AI knowledge base"
summary = "Turn your notes, manuals, policies and documents into an assistant that answers from your own sources."
difficulty = "Beginner"
minutes = 30
saves = "Hours of searching through files"
tools = ["NotebookLM, a Claude Project, a ChatGPT Project or a custom GPT/Gem", "Your documents"]
free = false
+++

How many times have you searched for "that PDF with the warranty details" or "the email where we agreed the price"? A personal knowledge base lets you ask questions and get answers grounded in **your own** documents, with references.

## Step 1: Choose your container

Any of these work well:

- **NotebookLM:** built for this. Answers cite your sources, and it can create study guides and audio overviews.
- **A Claude or ChatGPT Project:** add files to the project knowledge; every chat in it can use them.
- **A custom GPT or Gem:** good if you want a reusable assistant for a specific topic.

## Step 2: Pick a theme

Don't dump everything in one place. Create focused knowledge bases:

- **Home:** appliance manuals, warranties, insurance policies, tenancy or mortgage documents, utility contracts.
- **Work:** policies, product docs, processes, your own notes.
- **Learning:** course materials, books' notes, articles.
- **Health (careful):** your own notes and appointment summaries, with identifiers removed.

## Step 3: Prepare the documents

- Prefer text-based PDFs and documents over blurry photos.
- Give files clear names: `Boiler manual - Worcester 2021.pdf`.
- Remove or redact sensitive details you don't need (account numbers, ID numbers).
- Delete outdated versions so answers don't mix old and new information.

## Step 4: Add standing instructions

```prompt
Answer only using the documents in this project. Quote or reference the specific document and section for every answer. If the documents don't contain the answer, say so clearly rather than guessing. Keep answers short, then offer more detail.
```

## Step 5: Ask useful questions

- "What does my home insurance say about accidental water damage? Quote the clause."
- "How do I descale the coffee machine, step by step?"
- "When does the warranty on the washing machine expire?"
- "Summarise every deadline mentioned across these documents."

## Keep it fresh

Set a calendar reminder each quarter: add new documents, remove outdated ones, and ask, "What's missing from this knowledge base that I keep needing?"

> [!WARNING]
> Check your app's privacy settings before uploading personal documents, and for anything high-stakes (insurance claims, legal terms), read the quoted clause yourself.
