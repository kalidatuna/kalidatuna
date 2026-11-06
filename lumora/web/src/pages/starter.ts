import { get } from '../api';
import { store } from '../store';
import { model3d } from '../ui/components';
import { esc, setTitle } from '../util';

interface P { slug: string; title: string; description: string; free: boolean; prompt: string | null }

export default async function starter(el: HTMLElement) {
  setTitle('Free AI Starter Kit', 'The Lumora AI Starter Kit: the 10 most useful prompts, a privacy checklist and a 7-day plan.');
  const data = await get<{ prompts: P[] }>('/prompts');
  const picks = data.prompts.filter((p) => p.free && p.prompt).slice(0, 10);
  el.innerHTML = `
  <section class="container narrow page-pad starter">
    <div class="library-head" data-hover-host>
      <div><span class="eyebrow">Free download</span><h1>Your AI <span class="grad">Starter Kit</span></h1>
      <p class="lead">Everything you need for your first week with AI. Bookmark this page or print it.</p>
      <button class="btn btn-secondary btn-sm no-print" data-print>Print / save as PDF</button></div>
      ${model3d('sparkle', '#ffd166', 'model-head')}
    </div>
    <div class="card kit-block">
      <h2>1 · Your 7-day AI habit plan</h2>
      <ol class="kit-days">
        <li><strong>Day 1:</strong> Install one assistant on your phone and computer. Set your privacy settings and write custom instructions (Lesson 4).</li>
        <li><strong>Day 2:</strong> Use the “Calm reply” prompt on a message you've been avoiding.</li>
        <li><strong>Day 3:</strong> Plan this week's dinners with the meal-plan prompt.</li>
        <li><strong>Day 4:</strong> Ask AI to explain something you've always wondered about, then use “Quiz me”.</li>
        <li><strong>Day 5:</strong> Run your inbox through the triage prompt.</li>
        <li><strong>Day 6:</strong> Make a decision with the decision-matrix prompt.</li>
        <li><strong>Day 7:</strong> List your weekly tasks and run “What should I automate?”.</li>
      </ol>
    </div>
    <div class="card kit-block">
      <h2>2 · The privacy checklist</h2>
      <ul class="checks">
        <li>Never paste passwords, PINs, full card or bank numbers.</li>
        <li>Remove names, addresses and account numbers from documents first.</li>
        <li>Check “improve the model” / training settings in your app.</li>
        <li>Review what memory has saved about you, monthly.</li>
        <li>Use your employer's approved tool for work data.</li>
        <li>Set a family “safe word” to defeat voice-clone scams.</li>
      </ul>
    </div>
    <div class="kit-block">
      <h2>3 · The 10 prompts to start with</h2>
      ${picks.map((p, i) => `<div class="kit-prompt card"><h3>${i + 1}. ${esc(p.title)}</h3><p class="muted">${esc(p.description)}</p><pre class="prompt-text">${esc(p.prompt)}</pre></div>`).join('')}
    </div>
    <div class="cta-band card no-print">
      <div><h2>Ready for the full course?</h2><p>The free Foundations module takes about 30 minutes and changes how you use AI forever.</p>
      <a class="btn btn-primary" href="${store.user ? '/learn' : '/signup'}">${store.user ? 'Go to the curriculum' : 'Create your free account'}</a></div>
    </div>
  </section>`;
  el.querySelector('[data-print]')!.addEventListener('click', () => window.print());
}
