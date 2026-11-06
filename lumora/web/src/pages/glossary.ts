import { get } from '../api';
import { loading, model3d } from '../ui/components';
import { debounce, esc, highlight, setTitle, slugify } from '../util';

interface Term {
  term: string;
  definition: string;
  example?: string;
}

export default async function glossary(el: HTMLElement) {
  setTitle('AI glossary', 'Plain-English definitions of AI terms: LLM, tokens, hallucination, agents, MCP, RAG, prompt injection and more.');
  el.innerHTML = loading('Loading glossary');
  const { terms } = await get<{ terms: Term[] }>('/glossary');
  const letters = [...new Set(terms.map((t) => t.term[0]!.toUpperCase()))];
  el.innerHTML = `
  <section class="container page-pad">
    <div class="library-head" data-hover-host>
      <div>
        <span class="eyebrow">Free resource</span>
        <h1>The AI glossary, <span class="grad">in plain English</span></h1>
        <p class="lead">${terms.length} terms you'll hear about AI, explained the way a friend would explain them.</p>
      </div>
      ${model3d('book', '#5cc8ff', 'model-head')}
    </div>
    <div class="filters card">
      <input type="search" placeholder="Search terms…" aria-label="Search glossary" data-q />
      <div class="chips letters">${letters.map((l) => `<a class="chip" href="#letter-${l}">${l}</a>`).join('')}</div>
    </div>
    <div class="glossary-list"></div>
  </section>`;
  const list = el.querySelector<HTMLElement>('.glossary-list')!;
  const paint = (q: string) => {
    const needle = q.trim().toLowerCase();
    const shown = terms.filter((t) => !needle || t.term.toLowerCase().includes(needle) || t.definition.toLowerCase().includes(needle));
    let last = '';
    list.innerHTML = shown.length
      ? shown
          .map((t) => {
            const letter = t.term[0]!.toUpperCase();
            const head = letter !== last && !needle ? `<h2 class="letter" id="letter-${letter}">${letter}</h2>` : '';
            last = letter;
            return `${head}<article class="term card" id="${slugify(t.term)}"><h3>${highlight(t.term, q)}</h3><p>${highlight(t.definition, q)}</p>${t.example ? `<p class="example"><span>Example</span>${esc(t.example)}</p>` : ''}</article>`;
          })
          .join('')
      : '<div class="card empty"><h3>No matching terms</h3></div>';
  };
  paint('');
  el.querySelector<HTMLInputElement>('[data-q]')!.addEventListener('input', debounce((e: Event) => paint((e.target as HTMLInputElement).value), 100));
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    target?.classList.add('focus');
    setTimeout(() => target?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }
}
