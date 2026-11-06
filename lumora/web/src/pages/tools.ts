import { get } from '../api';
import { loading, model3d } from '../ui/components';
import { esc, setTitle, slugify } from '../util';

interface Tool {
  name: string;
  category: string;
  url: string;
  what: string;
  best_for: string;
  pricing: string;
  free_tier: boolean;
}

export default async function tools(el: HTMLElement) {
  setTitle('AI Tool Finder', 'An honest, plain-English guide to the best AI tools for writing, research, automation, design, video and more.');
  el.innerHTML = loading('Loading tools');
  const data = await get<{ categories: string[]; tools: Tool[] }>('/tools');
  let category = '';
  let freeOnly = false;
  el.innerHTML = `
  <section class="container page-pad">
    <div class="library-head" data-hover-host>
      <div>
        <span class="eyebrow">Free resource</span>
        <h1>AI Tool <span class="grad">Finder</span></h1>
        <p class="lead">${data.tools.length} hand-picked tools, what they're genuinely good for, and whether there's a free tier. No sponsored placements.</p>
      </div>
      ${model3d('compass', '#5cc8ff', 'model-head')}
    </div>
    <div class="filters card">
      <div class="chips">
        <button class="chip active" data-cat="">All</button>
        ${data.categories.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
        <label class="chip toggle"><input type="checkbox" data-free /> Free tier only</label>
      </div>
    </div>
    <div class="tool-grid"></div>
    <p class="fine">Pricing changes often. Always check the official site before you buy.</p>
  </section>`;
  const grid = el.querySelector<HTMLElement>('.tool-grid')!;
  const paint = () => {
    const list = data.tools.filter((t) => (!category || t.category === category) && (!freeOnly || t.free_tier));
    grid.innerHTML = list
      .map(
        (t) => `
      <article class="tool-card card" id="${slugify(t.name)}">
        <header><span class="tool-initial">${esc(t.name[0])}</span><div><h3>${esc(t.name)}</h3><span class="badge">${esc(t.category)}</span></div></header>
        <p>${esc(t.what)}</p>
        <dl><dt>Best for</dt><dd>${esc(t.best_for)}</dd><dt>Pricing</dt><dd>${esc(t.pricing)}</dd></dl>
        <a class="btn btn-ghost btn-sm" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Visit site ↗</a>
      </article>`,
      )
      .join('');
  };
  paint();
  el.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
    if (!c) return;
    category = c.dataset.cat ?? '';
    el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x === c));
    paint();
  });
  el.querySelector<HTMLInputElement>('[data-free]')!.addEventListener('change', (e) => {
    freeOnly = (e.target as HTMLInputElement).checked;
    (e.target as HTMLElement).closest('.chip')!.classList.toggle('active', freeOnly);
    paint();
  });
  if (location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
}
