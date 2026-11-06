import { refresh } from '../hooks';
import { store } from '../store';
import { model3d } from '../ui/components';
import { esc, setTitle } from '../util';

export default async function welcome(el: HTMLElement) {
  setTitle('Welcome to Pro');
  await store.refreshUser();
  const name = esc(store.user?.name.split(' ')[0] ?? 'friend');
  el.innerHTML = `
  <section class="container narrow page-pad welcome">
    <div class="confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
    <div class="card welcome-card" data-hover-host>
      ${model3d('trophy', '#ffd166', 'model-welcome')}
      <span class="eyebrow">Payment confirmed</span>
      <h1>You're in, ${name}! <span class="grad">Welcome to Pro.</span></h1>
      <p class="lead">Every lesson, quiz, prompt and playbook is now unlocked. A receipt is on its way to your inbox.</p>
      <div class="welcome-next">
        <a class="card" href="/learn"><strong>📚 Continue the curriculum</strong><span class="muted">Pick up where you left off.</span></a>
        <a class="card" href="/prompts"><strong>✦ Explore 60+ prompts</strong><span class="muted">Copy, paste, done.</span></a>
        <a class="card" href="/playbooks"><strong>⚙ Build an automation</strong><span class="muted">Start with the inbox digest.</span></a>
      </div>
    </div>
  </section>`;
  refresh();
}
