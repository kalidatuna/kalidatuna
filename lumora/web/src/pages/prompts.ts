import { del, get, post } from '../api';
import { refresh } from '../hooks';
import type { Ctx } from '../router';
import { store } from '../store';
import { loading, model3d } from '../ui/components';
import { copyText, debounce, esc, highlight, setTitle, toast } from '../util';

interface Prompt {
  slug: string;
  title: string;
  category: string;
  description: string;
  tags: string[];
  free: boolean;
  locked: boolean;
  prompt: string | null;
}
interface PromptData {
  categories: string[];
  total: number;
  free_count: number;
  prompts: Prompt[];
}

export default async function prompts(el: HTMLElement, ctx: Ctx) {
  setTitle('Prompt library', '60+ copy-and-paste AI prompts for emails, work, money, family, learning, business and automation.');
  el.innerHTML = loading('Loading prompts');
  const [data, bookmarks] = await Promise.all([
    get<PromptData>('/prompts'),
    store.user ? get<{ bookmarks: { kind: string; ref: string }[] }>('/bookmarks').then((b) => b.bookmarks) : Promise.resolve([]),
  ]);
  const saved = new Set(bookmarks.filter((b) => b.kind === 'prompt').map((b) => b.ref));
  let category = ctx.query.get('category') ?? '';
  let query = ctx.query.get('q') ?? '';
  let onlySaved = false;
  const focus = ctx.query.get('focus');

  el.innerHTML = `
  <section class="container page-pad">
    <div class="library-head" data-hover-host>
      <div>
        <span class="eyebrow">Prompt library</span>
        <h1>${data.total} prompts that <span class="grad">just work</span></h1>
        <p class="lead">Copy, fill in the [brackets], paste into any AI assistant. ${data.free_count} are free for everyone; Pro unlocks the full library.</p>
      </div>
      ${model3d('sparkle', '#ff7ad9', 'model-head')}
    </div>
    <div class="filters card">
      <input type="search" placeholder="Search prompts (e.g. email, budget, interview)" value="${esc(query)}" aria-label="Search prompts" data-q />
      <div class="chips" role="tablist">
        <button class="chip ${category ? '' : 'active'}" data-cat="">All</button>
        ${data.categories.map((c) => `<button class="chip ${c === category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
        ${store.user ? '<button class="chip" data-saved>★ Saved</button>' : ''}
      </div>
    </div>
    <p class="muted result-count" aria-live="polite"></p>
    <div class="prompt-grid"></div>
  </section>`;

  const grid = el.querySelector<HTMLElement>('.prompt-grid')!;
  const count = el.querySelector<HTMLElement>('.result-count')!;

  const paint = () => {
    const q = query.trim().toLowerCase();
    const list = data.prompts.filter(
      (p) =>
        (!category || p.category === category) &&
        (!onlySaved || saved.has(p.slug)) &&
        (!q || [p.title, p.description, p.category, ...p.tags].some((s) => s.toLowerCase().includes(q))),
    );
    count.textContent = `${list.length} prompt${list.length === 1 ? '' : 's'}`;
    grid.innerHTML = list.length
      ? list
          .map(
            (p) => `
      <article class="prompt-card card ${p.locked ? 'locked' : ''}" id="p-${p.slug}">
        <header>
          <span class="badge">${esc(p.category)}</span>
          ${p.free ? '<span class="badge badge-free">Free</span>' : '<span class="badge badge-pro">Pro</span>'}
          ${store.user && !p.locked ? `<button class="icon-star ${saved.has(p.slug) ? 'on' : ''}" data-star="${p.slug}" aria-label="Save prompt">${saved.has(p.slug) ? '★' : '☆'}</button>` : ''}
        </header>
        <h3>${highlight(p.title, query)}</h3>
        <p class="muted">${highlight(p.description, query)}</p>
        ${
          p.locked
            ? `<div class="prompt-locked"><div class="blur-lines" aria-hidden="true"><span></span><span></span><span></span></div><a class="btn btn-secondary btn-sm" href="/pricing">🔒 Unlock with Pro</a></div>`
            : `<pre class="prompt-text">${esc(p.prompt ?? '')}</pre><div class="prompt-actions"><button class="btn btn-primary btn-sm" data-copy="${p.slug}">Copy prompt</button><span class="tags">${p.tags.map((t) => `#${esc(t)}`).join(' ')}</span></div>`
        }
      </article>`,
          )
          .join('')
      : `<div class="card empty"><h3>No prompts match</h3><p class="muted">Try a different word or category.</p></div>`;
  };
  paint();

  if (focus) {
    const card = document.getElementById(`p-${focus}`);
    if (card) {
      card.classList.add('focus');
      setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }

  const updateUrl = () => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (query) params.set('q', query);
    history.replaceState({}, '', `/prompts${params.toString() ? `?${params}` : ''}`);
  };

  el.querySelector<HTMLInputElement>('[data-q]')!.addEventListener(
    'input',
    debounce((e: Event) => {
      query = (e.target as HTMLInputElement).value;
      paint();
      updateUrl();
    }, 120),
  );
  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const cat = t.closest<HTMLElement>('[data-cat]');
    if (cat) {
      category = cat.dataset.cat ?? '';
      onlySaved = false;
      el.querySelectorAll('.chips .chip').forEach((c) => c.classList.toggle('active', c === cat));
      paint();
      updateUrl();
      return;
    }
    if (t.closest('[data-saved]')) {
      onlySaved = !onlySaved;
      category = '';
      el.querySelectorAll('.chips .chip').forEach((c) => c.classList.toggle('active', onlySaved ? c.hasAttribute('data-saved') : c.getAttribute('data-cat') === ''));
      paint();
      return;
    }
    const copy = t.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const p = data.prompts.find((x) => x.slug === copy.dataset.copy);
      if (p?.prompt && (await copyText(p.prompt))) {
        copy.textContent = 'Copied ✓';
        toast('Prompt copied. Paste it into your AI assistant.');
        setTimeout(() => (copy.textContent = 'Copy prompt'), 1600);
      }
      return;
    }
    const star = t.closest<HTMLElement>('[data-star]');
    if (star) {
      const slug = star.dataset.star!;
      if (saved.has(slug)) {
        await del('/bookmarks', { kind: 'prompt', ref: slug });
        saved.delete(slug);
      } else {
        await post('/bookmarks', { kind: 'prompt', ref: slug });
        saved.add(slug);
        toast('Saved to your dashboard.');
      }
      star.classList.toggle('on', saved.has(slug));
      star.textContent = saved.has(slug) ? '★' : '☆';
    }
  });
  refresh();
}
