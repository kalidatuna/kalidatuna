import { ApiError, post, type User } from '../api';
import { navigate, type Ctx } from '../router';
import { store } from '../store';
import { LOGO } from '../ui/layout';
import { esc, setTitle, toast } from '../util';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export default function auth(el: HTMLElement, ctx: Ctx) {
  const signup = ctx.path === '/signup';
  const next = safeNext(ctx.query.get('next'));
  const plan = ctx.query.get('plan');
  if (store.user) {
    navigate(next, { replace: true });
    return;
  }
  setTitle(signup ? 'Create your free account' : 'Sign in');
  el.innerHTML = `
  <section class="container auth-wrap page-pad">
    <div class="auth-card card">
      <a class="brand" href="/">${LOGO}<span>Lumora</span></a>
      <h1>${signup ? 'Start learning free' : 'Welcome back'}</h1>
      <p class="muted">${signup ? (plan ? 'Create your account, then complete checkout.' : 'No card needed. Takes 20 seconds.') : 'Sign in to continue where you left off.'}</p>
      <form novalidate>
        ${signup ? '<label class="field"><span>Your name</span><input name="name" autocomplete="name" required maxlength="80" /></label>' : ''}
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
        <label class="field"><span>Password</span>
          <span class="pw"><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" /><button type="button" class="pw-toggle" aria-label="Show password">Show</button></span>
        </label>
        ${signup ? '<p class="fine">At least 8 characters. By creating an account you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>' : ''}
        <p class="form-error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">${signup ? 'Create free account' : 'Sign in'}</button>
      </form>
      <p class="switch">${signup ? `Already have an account? <a href="/login?next=${esc(encodeURIComponent(next))}">Sign in</a>` : `New to Lumora? <a href="/signup?next=${esc(encodeURIComponent(next))}">Create a free account</a>`}</p>
    </div>
    <ul class="auth-perks">
      <li>✦ 13 free lessons, including the full Foundations module</li>
      <li>✦ Free prompts, Prompt Builder, glossary & Tool Finder</li>
      <li>✦ Progress tracking, streaks and quizzes</li>
    </ul>
  </section>`;
  const form = el.querySelector('form')!;
  const error = el.querySelector<HTMLElement>('.form-error')!;
  el.querySelector('.pw-toggle')!.addEventListener('click', (e) => {
    const input = form.elements.namedItem('password') as HTMLInputElement;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    (e.currentTarget as HTMLButtonElement).textContent = show ? 'Hide' : 'Show';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
    if (signup && !v('name').trim()) return void (error.textContent = 'Please tell us your name.');
    if (!/^\S+@\S+\.\S+$/.test(v('email'))) return void (error.textContent = 'Please enter a valid email address.');
    if (v('password').length < 8) return void (error.textContent = 'Passwords are at least 8 characters.');
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    try {
      const body = signup ? { name: v('name'), email: v('email'), password: v('password') } : { email: v('email'), password: v('password') };
      const r = await post<{ user: User }>(signup ? '/auth/signup' : '/auth/login', body);
      store.setUser(r.user);
      toast(signup ? `Welcome to Lumora, ${r.user.name.split(' ')[0]}!` : 'Signed in.');
      if (plan) {
        const { url } = await post<{ url: string }>('/billing/checkout', { plan });
        if (url.startsWith('/')) navigate(url);
        else location.href = url;
      } else {
        navigate(signup && next === '/dashboard' ? '/learn/what-ai-really-is' : next);
      }
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      btn.disabled = false;
    }
  });
  (form.querySelector('input') as HTMLInputElement).focus();
}
