import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/api';

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api client', () => {
  it('prefixes /api and parses JSON', async () => {
    const f = mockFetch(200, { ok: 1 });
    await expect(api('/health')).resolves.toEqual({ ok: 1 });
    expect(f.mock.calls[0][0]).toBe('/api/health');
  });
  it('sends JSON bodies with a JSON content type (required by CSRF guard)', async () => {
    const f = mockFetch(200, {});
    await api('/auth/logout', 'POST');
    const init = f.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{}');
    expect(init.credentials).toBe('same-origin');
  });
  it('raises typed errors with the server message', async () => {
    mockFetch(402, { error: { code: 'payment_required', message: 'This content is part of Lumora Pro.' } });
    const err = (await api('/lessons/x/complete', 'POST').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('payment_required');
    expect(err.message).toContain('Pro');
  });
  it('handles non-JSON errors and network failures', async () => {
    mockFetch(502, '<html>bad gateway</html>');
    await expect(api('/x')).rejects.toMatchObject({ status: 502, code: 'error' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(api('/x')).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});
