import { EMPTY_FIELDS, PRESETS, buildPrompt, scorePrompt, type BuilderFields } from '../builder-logic';
import { refresh } from '../hooks';
import { store } from '../store';
import { model3d } from '../ui/components';
import { copyText, esc, setTitle, toast } from '../util';

const field = (name: keyof BuilderFields, label: string, hint: string, rows = 0) => `
  <label class="field"><span>${label} <em class="hint">${hint}</em></span>
  ${rows ? `<textarea name="${name}" rows="${rows}"></textarea>` : `<input name="${name}" />`}</label>`;

export default function builder(el: HTMLElement) {
  setTitle('Prompt Builder', 'Free interactive tool: build a great AI prompt in 60 seconds with the BRIEF method.');
  el.innerHTML = `
  <section class="container page-pad">
    <div class="library-head" data-hover-host>
      <div>
        <span class="eyebrow">Free tool</span>
        <h1>The <span class="grad">Prompt Builder</span></h1>
        <p class="lead">Fill in a few boxes and get a well-structured prompt using the BRIEF method from Lumora's Prompting module. Works with ChatGPT, Claude, Gemini and Copilot.</p>
      </div>
      ${model3d('bubble', '#5cc8ff', 'model-head')}
    </div>
    <div class="builder">
      <form class="card builder-form" autocomplete="off">
        <div class="chips presets"><span class="muted">Start from:</span>${Object.keys(PRESETS).map((p) => `<button type="button" class="chip" data-preset="${p}">${p}</button>`).join('')}</div>
        ${field('intent', 'Task', 'What do you want done?', 2)}
        ${field('background', 'Background', 'The situation, people involved, deadlines', 3)}
        ${field('role', 'Role', 'e.g. a patient tutor, a sharp editor')}
        <div class="field-row">
          ${field('length', 'Length', 'e.g. under 150 words')}
          ${field('tone', 'Tone', 'e.g. warm, direct, playful')}
        </div>
        ${field('structure', 'Structure', 'e.g. a table, bullet points, a checklist')}
        ${field('examples', 'Example (optional)', 'Paste something in the style you like', 2)}
        ${field('avoid', 'Avoid (optional)', 'e.g. jargon, emojis, clichés')}
        <label class="check"><input type="checkbox" name="askFirst" /> Let the AI ask me questions first</label>
        <button type="reset" class="btn btn-ghost btn-sm">Clear</button>
      </form>
      <div class="builder-out">
        <div class="card score-card">
          <div class="score-top"><strong data-label>Needs detail</strong><span data-score>0</span></div>
          <div class="bar"><span data-bar style="width:0%"></span></div>
          <ul class="tips" data-tips></ul>
        </div>
        <div class="prompt-block card-like">
          <div class="prompt-bar"><span>✦ Your prompt</span><button class="btn btn-xs btn-secondary" data-copy type="button">Copy</button></div>
          <code data-out>Your prompt will appear here as you type…</code>
        </div>
        <div class="open-in">
          <a class="btn btn-secondary btn-sm" data-open="chatgpt" target="_blank" rel="noopener noreferrer" href="https://chatgpt.com/">Open in ChatGPT ↗</a>
          <a class="btn btn-secondary btn-sm" data-open="claude" target="_blank" rel="noopener noreferrer" href="https://claude.ai/new">Open in Claude ↗</a>
        </div>
        ${store.user?.has_pro ? '' : `<div class="card upsell"><strong>Want to master this?</strong><p class="muted">The Prompting module teaches the follow-up moves and advanced patterns that turn good prompts into great results.</p><a class="btn btn-primary btn-sm" href="/learn/anatomy-of-a-great-prompt">Read the free lesson</a></div>`}
      </div>
    </div>
  </section>`;

  const form = el.querySelector<HTMLFormElement>('.builder-form')!;
  const out = el.querySelector<HTMLElement>('[data-out]')!;
  const read = (): BuilderFields => {
    const fd = new FormData(form);
    const f = { ...EMPTY_FIELDS };
    (Object.keys(EMPTY_FIELDS) as (keyof BuilderFields)[]).forEach((k) => {
      if (k === 'askFirst') f.askFirst = fd.get('askFirst') === 'on';
      else f[k] = String(fd.get(k) ?? '');
    });
    return f;
  };
  const update = () => {
    const f = read();
    const prompt = buildPrompt(f);
    out.textContent = prompt || 'Your prompt will appear here as you type…';
    const s = scorePrompt(f);
    el.querySelector('[data-score]')!.textContent = `${s.score}/100`;
    el.querySelector('[data-label]')!.textContent = s.label;
    el.querySelector<HTMLElement>('[data-bar]')!.style.width = `${s.score}%`;
    el.querySelector('[data-tips]')!.innerHTML = s.tips.map((t) => `<li>${esc(t)}</li>`).join('') || '<li>Looks great. Copy it and try it!</li>';
    const q = encodeURIComponent(prompt);
    el.querySelector<HTMLAnchorElement>('[data-open="chatgpt"]')!.href = prompt ? `https://chatgpt.com/?q=${q}` : 'https://chatgpt.com/';
    el.querySelector<HTMLAnchorElement>('[data-open="claude"]')!.href = prompt ? `https://claude.ai/new?q=${q}` : 'https://claude.ai/new';
  };
  form.addEventListener('input', update);
  form.addEventListener('reset', () => setTimeout(update));
  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = PRESETS[b.dataset.preset!];
      Object.entries(p).forEach(([k, v]) => {
        const input = form.elements.namedItem(k) as HTMLInputElement | null;
        if (input) input.value = String(v);
      });
      el.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('active', x === b));
      update();
    }),
  );
  el.querySelector('[data-copy]')!.addEventListener('click', async () => {
    const text = buildPrompt(read());
    if (!text) return toast('Fill in the task first.', 'info');
    if (await copyText(text)) toast('Prompt copied!');
  });
  update();
  refresh();
}
