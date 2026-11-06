import { describe, expect, it } from 'vitest';
import { EMPTY_FIELDS, PRESETS, buildPrompt, scorePrompt } from '../src/builder-logic';

describe('prompt builder', () => {
  it('builds nothing from empty fields', () => {
    expect(buildPrompt(EMPTY_FIELDS)).toBe('');
    expect(scorePrompt(EMPTY_FIELDS).score).toBe(0);
    expect(scorePrompt(EMPTY_FIELDS).label).toBe('Needs detail');
  });
  it('assembles BRIEF sections in order', () => {
    const p = buildPrompt({
      ...EMPTY_FIELDS,
      intent: 'Write a reminder email to a client about an overdue invoice.',
      background: 'Invoice #12 for $400 was due on 1 March. They are a friendly long-term client.',
      role: 'Act as a polite accounts assistant',
      length: 'under 100 words',
      tone: 'warm but clear',
      structure: 'subject line then email',
      avoid: 'threats',
      askFirst: true,
    });
    const order = ['Background:', 'Role:', 'Task:', 'Format:', 'Avoid:', 'Before you start'].map((k) => p.indexOf(k));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    expect(p).toContain('Role: Act as a polite accounts assistant.');
    expect(p).not.toContain('Act as Act as');
    expect(p).not.toContain('..');
  });
  it('scores a complete prompt highly', () => {
    const s = scorePrompt({
      ...EMPTY_FIELDS,
      intent: 'Plan five weeknight dinners for my family.',
      background: 'Two adults and two kids, one vegetarian, budget $90, 30 minutes max.',
      role: 'a practical home cook',
      length: 'one page',
      tone: 'friendly',
      structure: 'a table then a shopping list',
      examples: 'Monday: veggie chilli',
      avoid: 'seafood',
    });
    expect(s.score).toBeGreaterThanOrEqual(85);
    expect(s.label).toBe('Excellent');
  });
  it('presets leave brackets to fill in and say so', () => {
    for (const preset of Object.values(PRESETS)) {
      const s = scorePrompt({ ...EMPTY_FIELDS, ...preset });
      expect(s.score).toBeGreaterThan(0);
      expect(s.tips.length).toBeLessThanOrEqual(3);
    }
    const s = scorePrompt({ ...EMPTY_FIELDS, ...PRESETS.Email });
    expect(s.tips.join(' ')).toContain('[brackets]');
  });
});
