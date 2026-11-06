import { get, type CurriculumModule } from '../api';
import { store } from '../store';
import { loading, model3d, progressRing } from '../ui/components';
import { esc, hours, setTitle } from '../util';

interface Curriculum {
  modules: CurriculumModule[];
  totals: { lessons: number; completed: number; minutes: number };
  has_pro: boolean;
}

export default async function curriculum(el: HTMLElement) {
  setTitle('Curriculum', 'The full Lumora curriculum: 10 modules and 40 practical lessons on using AI in everyday life.');
  el.innerHTML = loading('Loading curriculum');
  const data = await get<Curriculum>('/curriculum');
  const pct = data.totals.lessons ? Math.round((data.totals.completed / data.totals.lessons) * 100) : 0;
  const signedIn = !!store.user;
  el.innerHTML = `
  <section class="container page-pad">
    <div class="curriculum-head">
      <div>
        <span class="eyebrow">The Lumora curriculum</span>
        <h1>From curious to <span class="grad">confident</span></h1>
        <p class="lead">${data.modules.length} modules · ${data.totals.lessons} lessons · about ${hours(data.totals.minutes)} of practical learning. Lessons marked <span class="badge badge-free">Free</span> are open to everyone.</p>
      </div>
      ${signedIn ? `<div class="curriculum-progress card">${progressRing(pct, 112, 'complete')}<div><strong>${data.totals.completed} of ${data.totals.lessons} lessons</strong><span class="muted">${data.has_pro ? 'Pro member: everything unlocked' : 'Free plan'}</span>${data.has_pro ? '' : '<a class="btn btn-primary btn-sm" href="/pricing">Unlock all lessons</a>'}</div></div>` : `<div class="curriculum-progress card"><div><strong>Track your progress</strong><span class="muted">Create a free account to save progress, take quizzes and earn your certificate.</span><a class="btn btn-primary btn-sm" href="/signup">Start free</a></div></div>`}
    </div>
    <nav class="module-jump chips" aria-label="Jump to module">${data.modules.map((m) => `<a class="chip" href="#${m.slug}" style="--c:${m.color}"><span class="dot" style="background:${m.color}"></span>${m.number}. ${esc(m.title)}</a>`).join('')}</nav>
    <div class="modules">
      ${data.modules.map((m) => moduleBlock(m, signedIn)).join('')}
    </div>
  </section>`;
}

function moduleBlock(m: CurriculumModule, signedIn: boolean) {
  const done = m.completed_count === m.lesson_count && m.lesson_count > 0;
  return `
  <article class="module-block card reveal" id="${m.slug}" style="--c:${m.color}" data-hover-host>
    <div class="module-side">
      ${model3d(m.model, m.color, 'model-module')}
      <span class="eyebrow">Module ${m.number}</span>
      <h2>${esc(m.title)}</h2>
      <p class="muted">${esc(m.description)}</p>
      <div class="module-stats"><span>${m.lesson_count} lessons</span><span>${m.minutes} min</span>${signedIn ? `<span>${m.completed_count}/${m.lesson_count} done</span>` : ''}</div>
      ${signedIn ? `<div class="bar"><span style="width:${Math.round((m.completed_count / m.lesson_count) * 100)}%"></span></div>` : ''}
      ${m.quiz.questions ? `<a class="btn ${done ? 'btn-primary' : 'btn-secondary'} btn-sm quiz-btn" href="/quiz/${m.slug}">${m.quiz.passed ? '✓ Quiz passed' : `Take the quiz (${m.quiz.questions} Qs)`}${!m.quiz.free && !store.user?.has_pro ? ' · Pro' : ''}</a>` : ''}
    </div>
    <ol class="lesson-list">
      ${m.lessons
        .map(
          (l, i) => `
        <li>
          <a class="lesson-row ${l.completed ? 'is-done' : ''} ${l.locked ? 'is-locked' : ''}" href="/learn/${l.slug}">
            <span class="lesson-num">${l.completed ? '✓' : i + 1}</span>
            <span class="lesson-text"><strong>${esc(l.title)}</strong><span>${esc(l.summary)}</span></span>
            <span class="lesson-meta">${l.locked ? '<span class="badge badge-pro">🔒 Pro</span>' : l.free ? '<span class="badge badge-free">Free</span>' : ''}<span class="mins">${l.minutes} min</span></span>
          </a>
        </li>`,
        )
        .join('')}
    </ol>
  </article>`;
}
