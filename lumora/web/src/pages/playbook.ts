import { ApiError, del, get, post } from '../api';
import { refresh } from '../hooks';
import type { Ctx } from '../router';
import { store } from '../store';
import { enhanceProse, loading, model3d, paywall } from '../ui/components';
import { esc, setTitle, toast } from '../util';

interface PBDetail {
  playbook: {
    slug: string; title: string; summary: string; difficulty: string; minutes: number; saves: string; tools: string[];
    free: boolean; locked: boolean; html: string | null; preview_html: string;
  };
}

export default async function playbook(el: HTMLElement, ctx: Ctx) {
  el.innerHTML = loading('Loading playbook');
  let data: PBDetail;
  try {
    data = await get<PBDetail>(`/playbooks/${encodeURIComponent(ctx.params.slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return (await import('./notfound')).default(el);
    throw e;
  }
  const p = data.playbook;
  setTitle(p.title, p.summary);
  let saved = store.user
    ? (await get<{ bookmarks: { kind: string; ref: string }[] }>('/bookmarks')).bookmarks.some((b) => b.kind === 'playbook' && b.ref === p.slug)
    : false;
  el.innerHTML = `
  <section class="container narrow page-pad">
    <a class="back-link" href="/playbooks">← All playbooks</a>
    <header class="lesson-head" data-hover-host>
      <div>
        <div class="lesson-crumbs"><span class="badge">${esc(p.difficulty)}</span>${p.free ? '<span class="badge badge-free">Free</span>' : '<span class="badge badge-pro">Pro</span>'}</div>
        <h1>${esc(p.title)}</h1>
        <p class="lead">${esc(p.summary)}</p>
        <div class="pb-meta"><span>⏱ ${p.minutes} min setup</span><span>⚡ Saves ${esc(p.saves)}</span>${store.user ? `<button class="btn btn-ghost btn-sm" data-bookmark>${saved ? '★ Saved' : '☆ Save'}</button>` : ''}</div>
        <div class="pb-tools">${p.tools.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      </div>
      ${model3d('gears', '#ffd166', 'model-lesson')}
    </header>
    <div class="prose ${p.locked ? 'is-preview' : ''}" id="pb-body">${p.locked ? p.preview_html : p.html}</div>
    ${p.locked ? paywall('playbook') : ''}
  </section>`;
  enhanceProse(el.querySelector('#pb-body')!);
  el.querySelector('[data-bookmark]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const body = { kind: 'playbook', ref: p.slug };
    saved ? await del('/bookmarks', body) : await post('/bookmarks', body);
    saved = !saved;
    btn.textContent = saved ? '★ Saved' : '☆ Save';
    toast(saved ? 'Saved to your dashboard.' : 'Removed from saved.');
  });
  refresh();
}
