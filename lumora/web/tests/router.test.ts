import { describe, expect, it } from 'vitest';
import { compile, match, route } from '../src/router';

const page = async () => ({ default: () => {} });
route('/', page);
route('/learn', page);
route('/learn/:slug', page);
route('/quiz/:slug', page);

describe('router', () => {
  it('compiles patterns', () => {
    const { regex, keys } = compile('/a/:x/b/:y');
    expect(keys).toEqual(['x', 'y']);
    expect(regex.test('/a/1/b/2')).toBe(true);
    expect(regex.test('/a/1/b')).toBe(false);
  });
  it('matches routes and decodes params', () => {
    expect(match('/')?.route.pattern).toBe('/');
    expect(match('/learn')?.route.pattern).toBe('/learn');
    expect(match('/learn/')?.route.pattern).toBe('/learn');
    const m = match('/learn/what-ai-really-is');
    expect(m?.route.pattern).toBe('/learn/:slug');
    expect(m?.params).toEqual({ slug: 'what-ai-really-is' });
    expect(match('/quiz/a%20b')?.params.slug).toBe('a b');
    expect(match('/nope')).toBeNull();
    expect(match('/learn/a/b')).toBeNull();
  });
});
