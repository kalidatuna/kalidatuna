import { ApiError, get, post } from '../api';
import type { Ctx } from '../router';
import { store } from '../store';
import { loading, model3d, paywall, progressRing } from '../ui/components';
import { esc, setTitle, toast } from '../util';
import { refresh } from '../hooks';

interface QuizData {
  module: { slug: string; title: string; color: string; model: string };
  locked: boolean;
  pass_percent: number;
  questions: { q: string; options: string[] }[];
  question_count: number;
  best: { score: number; total: number; passed: boolean } | null;
}
interface Result {
  score: number;
  total: number;
  passed: boolean;
  results: { correct: boolean; answer: number; given: number | null; why: string }[];
}

export default async function quiz(el: HTMLElement, ctx: Ctx) {
  const slug = ctx.params.slug;
  if (!store.user) {
    setTitle('Module quiz');
    el.innerHTML = `<section class="container narrow page-pad"><div class="card empty"><h1>Quizzes are for members</h1><p class="muted">Create a free account to take quizzes, track your scores and earn your certificate.</p><a class="btn btn-primary" href="/signup?next=/quiz/${esc(slug)}">Create free account</a> <a class="btn btn-ghost" href="/login?next=/quiz/${esc(slug)}">Sign in</a></div></section>`;
    return;
  }
  el.innerHTML = loading('Loading quiz');
  let data: QuizData;
  try {
    data = await get<QuizData>(`/modules/${encodeURIComponent(slug)}/quiz`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return (await import('./notfound')).default(el);
    throw e;
  }
  const m = data.module;
  setTitle(`${m.title} quiz`);
  const head = `
    <header class="quiz-head" data-hover-host>
      ${model3d(m.model, m.color, 'model-quiz')}
      <div><span class="eyebrow">Module quiz</span><h1>${esc(m.title)}</h1>
      <p class="muted">${data.question_count} questions · pass mark ${data.pass_percent}%${data.best ? ` · your best: ${data.best.score}/${data.best.total}${data.best.passed ? ' ✓' : ''}` : ''}</p></div>
    </header>`;
  if (data.locked) {
    el.innerHTML = `<section class="container narrow page-pad">${head}${paywall('quiz')}</section>`;
    return;
  }
  el.innerHTML = `
  <section class="container narrow page-pad">
    ${head}
    <form class="quiz-form" novalidate>
      ${data.questions
        .map(
          (q, i) => `
        <fieldset class="card question" data-q="${i}">
          <legend><span class="q-num">${i + 1}</span>${esc(q.q)}</legend>
          <div class="options">${q.options
            .map(
              (o, j) => `<label class="option"><input type="radio" name="q${i}" value="${j}" /><span class="option-mark"></span><span>${esc(o)}</span></label>`,
            )
            .join('')}</div>
          <div class="explain" hidden></div>
        </fieldset>`,
        )
        .join('')}
      <div class="quiz-actions"><span class="muted" data-answered>0 of ${data.questions.length} answered</span><button class="btn btn-primary btn-lg" type="submit">Check my answers</button></div>
    </form>
    <div class="quiz-result" hidden></div>
  </section>`;

  refresh();
  const form = el.querySelector<HTMLFormElement>('.quiz-form')!;
  const counter = el.querySelector<HTMLElement>('[data-answered]')!;
  const answers = (): (number | null)[] =>
    data.questions.map((_, i) => {
      const c = form.querySelector<HTMLInputElement>(`input[name="q${i}"]:checked`);
      return c ? Number(c.value) : null;
    });
  form.addEventListener('change', () => (counter.textContent = `${answers().filter((a) => a !== null).length} of ${data.questions.length} answered`));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const given = answers();
    if (given.some((a) => a === null)) {
      toast('Answer every question first.', 'info');
      const first = given.findIndex((a) => a === null);
      form.querySelector(`[data-q="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    try {
      const r = await post<Result>(`/modules/${slug}/quiz`, { answers: given });
      r.results.forEach((res, i) => {
        const fs = form.querySelector<HTMLElement>(`[data-q="${i}"]`)!;
        fs.classList.add(res.correct ? 'is-correct' : 'is-wrong');
        fs.querySelectorAll<HTMLLabelElement>('.option').forEach((lab, j) => {
          lab.classList.toggle('opt-correct', j === res.answer);
          lab.classList.toggle('opt-wrong', j === res.given && !res.correct);
          lab.querySelector('input')!.disabled = true;
        });
        const ex = fs.querySelector<HTMLElement>('.explain')!;
        ex.hidden = false;
        ex.innerHTML = `<strong>${res.correct ? 'Correct.' : 'Not quite.'}</strong> ${esc(res.why)}`;
      });
      const pct = Math.round((r.score / r.total) * 100);
      const result = el.querySelector<HTMLElement>('.quiz-result')!;
      result.hidden = false;
      result.innerHTML = `
        <div class="card result-card ${r.passed ? 'passed' : ''}">
          ${progressRing(pct, 120, `${r.score}/${r.total}`)}
          <div>
            <h2>${r.passed ? 'You passed! 🎉' : 'Almost there'}</h2>
            <p class="muted">${r.passed ? 'Great work. This module is marked as mastered on your dashboard.' : `You need ${data.pass_percent}% to pass. Review the explanations above and try again. You've got this.`}</p>
            <div class="paywall-actions">
              ${r.passed ? '<a class="btn btn-primary" href="/learn">Continue the curriculum</a>' : '<button class="btn btn-primary" data-retry>Try again</button>'}
              <a class="btn btn-ghost" href="/dashboard">Dashboard</a>
            </div>
          </div>
        </div>`;
      result.querySelector('[data-retry]')?.addEventListener('click', () => quiz(el, ctx));
      refresh();
      form.querySelector('.quiz-actions')!.remove();
      result.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not submit the quiz.', 'error');
      btn.disabled = false;
    }
  });
}
