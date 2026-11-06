// Pure logic for the Prompt Builder (unit-tested).

export interface BuilderFields {
  background: string;
  role: string;
  intent: string;
  examples: string;
  length: string;
  tone: string;
  structure: string;
  avoid: string;
  askFirst: boolean;
}

export const EMPTY_FIELDS: BuilderFields = {
  background: '',
  role: '',
  intent: '',
  examples: '',
  length: '',
  tone: '',
  structure: '',
  avoid: '',
  askFirst: false,
};

export const PRESETS: Record<string, Partial<BuilderFields>> = {
  Email: {
    role: 'a warm, professional writing assistant',
    intent: 'Write an email to [who] asking for [what] by [when].',
    tone: 'friendly but clear',
    length: 'under 120 words',
    structure: 'a subject line, then the email',
  },
  Plan: {
    role: 'an organised, realistic planner',
    intent: 'Create a plan for [goal] that fits my schedule.',
    structure: 'a day-by-day table, then a checklist',
    tone: 'encouraging and practical',
  },
  Learn: {
    role: 'a patient tutor',
    intent: 'Explain [topic] so I really understand it, then check my understanding with one question.',
    structure: 'a short explanation with an everyday analogy, then 5 key terms',
    tone: 'simple and friendly',
  },
  Decide: {
    role: 'a balanced, sceptical advisor',
    intent: 'Help me decide between [option A] and [option B].',
    structure: 'a comparison table, then a one-line recommendation and what would change it',
    tone: 'honest and direct',
  },
  Create: {
    role: 'a creative partner with strong taste',
    intent: 'Give me ideas for [project].',
    structure: '10 varied ideas, then your top 3 with reasons',
    tone: 'playful and original',
  },
  Automate: {
    role: 'a no-code automation expert who explains things simply',
    intent: 'Design an automation for [repetitive task].',
    structure: 'the trigger, each action step, the tool to use, and how to test it',
    tone: 'clear, step by step',
  },
};

export function buildPrompt(f: BuilderFields): string {
  const lines: string[] = [];
  if (f.background.trim()) lines.push(`Background: ${f.background.trim()}`);
  if (f.role.trim()) lines.push(`Role: Act as ${f.role.trim().replace(/^act as\s+/i, '')}.`);
  if (f.intent.trim()) lines.push(`Task: ${f.intent.trim()}`);
  if (f.examples.trim()) lines.push(`Example of what I like:\n${f.examples.trim()}`);
  const format: string[] = [];
  if (f.length.trim()) format.push(f.length.trim());
  if (f.structure.trim()) format.push(`structured as ${f.structure.trim()}`);
  if (f.tone.trim()) format.push(`tone: ${f.tone.trim()}`);
  if (format.length) lines.push(`Format: ${format.join('; ')}.`);
  if (f.avoid.trim()) lines.push(`Avoid: ${f.avoid.trim()}.`);
  if (f.askFirst) lines.push('Before you start, ask me up to 3 questions if anything important is unclear.');
  return lines.join('\n\n').replace(/\.\./g, '.');
}

export interface Score {
  score: number;
  label: string;
  tips: string[];
}

export function scorePrompt(f: BuilderFields): Score {
  let score = 0;
  const tips: string[] = [];
  const intent = f.intent.trim();
  if (intent.length >= 15) score += 30;
  else if (intent) {
    score += 12;
    tips.push('Make the task more specific: what exactly should the result do?');
  } else tips.push('Start with the task: what do you want the AI to do?');
  if (f.background.trim().length >= 25) score += 25;
  else tips.push('Add background: who is involved, what has happened, any deadlines.');
  if (f.role.trim()) score += 10;
  else tips.push('Give it a role, like "a patient tutor" or "a sharp editor".');
  const formatBits = [f.length, f.tone, f.structure].filter((x) => x.trim()).length;
  score += formatBits * 8;
  if (formatBits < 2) tips.push('Say how you want it: length, tone and structure.');
  if (f.examples.trim()) score += 6;
  if (f.avoid.trim()) score += 5;
  if (f.askFirst) score += 0;
  if (/\[[^\]]+\]/.test(buildPrompt(f))) tips.push('Replace the [brackets] with your real details.');
  score = Math.min(100, score);
  const label = score >= 85 ? 'Excellent' : score >= 65 ? 'Strong' : score >= 40 ? 'Getting there' : 'Needs detail';
  return { score, label, tips: tips.slice(0, 3) };
}
