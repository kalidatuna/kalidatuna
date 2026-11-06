import { ApiError, post, type User } from '../api';
import { navigate, type Ctx } from '../router';
import { store } from '../store';
import { LOGO } from '../ui/layout';
import { setTitle, toast } from '../util';

/** /forgot-password and /reset-password?token=… */
export default function recover(el: HTMLElement, ctx: Ctx) {
  const resetting = ctx.path === '/reset-password';
  const token = ctx.query.get('token') ?? '';
  setTitle(resetting ? 'Choose a new password' : 'Reset your password');
  el.innerHTML = `
  <section class="container auth-wrap page-pad">
    <div class="auth-card card">
      <a class="brand" href="/">${LOGO}<span>Lumora</span></a>
      ${
        resetting
          ? `<h1>Choose a new password</h1><p class="muted">Pick something at least 8 characters long. You'll be signed in straight away.</p>
             <form novalidate>
               <label class="field"><span>New password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required /></label>
               <label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="8" required /></label>
               <p class="form-error" role="alert">${token ? '' : 'This link is missing its token. Please request a new one.'}</p>
               <button class="btn btn-primary btn-block btn-lg" type="submit" ${token ? '' : 'disabled'}>Save new password</button>
             </form>
             <p class="switch"><a href="/forgot-password">Request a new link</a></p>`
          : `<h1>Forgot your password?</h1><p class="muted">Enter your email and we'll send you a link to choose a new one.</p>
             <form novalidate>
               <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
               <p class="form-error" role="alert"></p>
               <button class="btn btn-primary btn-block btn-lg" type="submit">Send reset link</button>
             </form>
             <div class="sent card" hidden><strong>Check your inbox ✉️</strong><p class="muted">If an account exists for that email, a reset link is on its way. It works for 1 hour.</p></div>
             <p class="switch">Remembered it? <a href="/login">Sign in</a></p>`
      }
    </div>
  </section>`;
  const form = el.querySelector('form')!;
  const error = el.querySelector<HTMLElement>('.form-error')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    try {
      if (resetting) {
        if (v('password').length < 8) return void (error.textContent = 'Use at least 8 characters.');
        if (v('password') !== v('confirm')) return void (error.textContent = "Those passwords don't match.");
        btn.disabled = true;
        const r = await post<{ user: User }>('/auth/reset', { token, password: v('password') });
        store.setUser(r.user);
        toast('Password updated. Welcome back!');
        navigate('/dashboard');
      } else {
        if (!/^\S+@\S+\.\S+$/.test(v('email'))) return void (error.textContent = 'Please enter a valid email address.');
        btn.disabled = true;
        await post('/auth/forgot', { email: v('email') });
        form.hidden = true;
        el.querySelector<HTMLElement>('.sent')!.hidden = false;
      }
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      btn.disabled = false;
    }
  });
  form.querySelector('input')?.focus();
}
