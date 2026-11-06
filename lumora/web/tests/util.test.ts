import { describe, expect, it } from 'vitest';
import { esc, highlight, hours, intervalLabel, money, plural, slugify } from '../src/util';

describe('util', () => {
  it('escapes HTML', () => {
    expect(esc('<img src=x onerror="a">&\'')).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
    expect(esc(null)).toBe('');
    expect(esc(42)).toBe('42');
  });
  it('formats money', () => {
    expect(money(1400)).toBe('$14');
    expect(money(825)).toBe('$8.25');
    expect(money(24900)).toBe('$249');
  });
  it('labels intervals', () => {
    expect(intervalLabel('month')).toBe('/month');
    expect(intervalLabel('year')).toBe('/year');
    expect(intervalLabel('once')).toBe(' once');
  });
  it('formats durations and plurals', () => {
    expect(hours(45)).toBe('45 min');
    expect(hours(363)).toBe('6.1 hours');
    expect(plural(1, 'lesson')).toBe('1 lesson');
    expect(plural(3, 'lesson')).toBe('3 lessons');
  });
  it('slugifies like the server', () => {
    expect(slugify('Prompt injection')).toBe('prompt-injection');
    expect(slugify('MCP (Model Context Protocol)')).toBe('mcp-model-context-protocol');
    expect(slugify('Artificial intelligence (AI)')).toBe('artificial-intelligence-ai');
  });
  it('highlights safely', () => {
    expect(highlight('Email <b>tips</b>', 'email')).toBe('<mark>Email</mark> &lt;b&gt;tips&lt;/b&gt;');
    expect(highlight('a(b)', 'a(')).toBe('<mark>a(</mark>b)');
    expect(highlight('short', 'x')).toBe('short');
  });
});
