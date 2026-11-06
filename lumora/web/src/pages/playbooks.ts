import { get } from '../api';
import { loading, model3d } from '../ui/components';
import { esc, setTitle } from '../util';

interface PB {
  slug: string;
  title: string;
  summary: string;
  difficulty: string;
  minutes: number;
  saves: string;
  tools: string[];
  free: boolean;
  locked: boolean;
}

export default async function playbooks(el: HTMLElement) {
  setTitle('Automation playbooks', 'Step-by-step, no-code AI automation recipes: receipt tracking, inbox digests, enquiry handling and more.');
  el.innerHTML = loading('Loading playbooks');
  const { playbooks } = await get<{ playbooks: PB[] }>('/playbooks');
  el.innerHTML = `
  <section class="container page-pad">
    <div class="library-head" data-hover-host>
      <div>
        <span class="eyebrow">Automation playbooks</span>
        <h1>Let the boring stuff <span class="grad">run itself</span></h1>
        <p class="lead">Step-by-step recipes for real automations with Zapier, Make, n8n and your AI assistant. No code required. Each one tells you exactly what to click, what to paste and how to test it.</p>
      </div>
      ${model3d('gears', '#ffd166', 'model-head')}
    </div>
    <div class="playbook-grid">
      ${playbooks
        .map(
          (p) => `
        <a class="playbook-card card reveal" href="/playbooks/${p.slug}">
          <div class="pb-top"><span class="badge">${esc(p.difficulty)}</span>${p.free ? '<span class="badge badge-free">Free</span>' : '<span class="badge badge-pro">Pro</span>'}</div>
          <h3>${esc(p.title)}</h3>
          <p class="muted">${esc(p.summary)}</p>
          <div class="pb-meta"><span>⏱ ${p.minutes} min setup</span><span>⚡ Saves ${esc(p.saves)}</span></div>
          <div class="pb-tools">${p.tools.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        </a>`,
        )
        .join('')}
    </div>
  </section>`;
}
