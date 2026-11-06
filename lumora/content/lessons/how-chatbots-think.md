+++
title = "How chatbots actually work"
summary = "Tokens, training, context windows and 'temperature', explained with everyday analogies so the quirks finally make sense."
minutes = 8
free = true
+++

You don't need to understand an engine to drive a car. But knowing roughly how it works helps you avoid stalling it. Ten minutes here will explain almost every "weird" thing an AI assistant does.

## Step 1: Training, or reading the library

Before you ever talk to it, a large language model (LLM) is **trained** on a huge collection of text: books, websites, articles, code and more. During training it plays one game billions of times: *guess the next word*.

By getting very, very good at that game, it ends up learning grammar, facts, writing styles, reasoning patterns and much more, all stored as numbers rather than as a database of facts.

After that, companies do extra training so the model behaves like a helpful assistant: following instructions, refusing harmful requests, and admitting uncertainty (with mixed success).

## Step 2: Tokens, the model's "words"

Models don't read letters or whole words. They read **tokens**, chunks of text roughly ¾ of a word long. "Unbelievable" might be three tokens: *un*, *believ*, *able*.

Why care? Because **limits and prices are measured in tokens**. When an app says you've hit a limit, it's counting tokens.

> [!NOTE]
> Rough rule of thumb: 1,000 tokens ≈ 750 English words ≈ 1.5 pages of text.

## Step 3: Prediction, one piece at a time

When you send a message, the model writes its reply **one token at a time**, each time asking "given everything so far, what's the most sensible next token?" That's why you see answers stream onto the screen.

This explains two important quirks:

1. **Fluency isn't accuracy.** The model is optimised to sound right. Usually that also means *being* right, but not always.
2. **Answers vary.** Ask the same question twice and you'll get different wording. A setting often called *temperature* controls how adventurous those choices are.

## Step 4: The context window, its working memory

Everything in the current conversation (your messages, its replies, any files you added) sits in the **context window**. Modern windows are large, often hundreds of pages, but they're not infinite.

- In a **very long chat**, early details can get less attention. Start a fresh chat for a new topic.
- The model **doesn't remember other chats** unless the app has a *memory* feature switched on.
- Pasting a document into the chat is how you "teach" it about your specific situation.

## Step 5: Tools, which give it hands and eyes

Modern assistants can also use **tools**: searching the web, running code to do maths, reading images, creating files, or connecting to your apps. When an answer includes live sources or a chart, a tool was probably involved.

| Quirk you notice | What's really going on |
| --- | --- |
| It made up a book that doesn't exist | Prediction produced a plausible-sounding title |
| It forgot something from earlier | The detail fell out of focus in a long context |
| It didn't know yesterday's news | Training has a cut-off date; no web search was used |
| It did perfect maths this time | It probably used a code/calculator tool |

## Try it now

```prompt
Explain how you generate your answers to me using an analogy about a chef. Then tell me honestly: what are three kinds of questions where I should double-check your answers, and why?
```

## Key takeaways

- LLMs learn by predicting the next token across vast amounts of text.
- Replies are generated piece by piece, so they're fluent but not guaranteed accurate.
- The context window is its working memory; start new chats for new topics.
- Tools like web search and code execution make answers more reliable when they're used.
