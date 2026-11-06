import type { Ctx } from '../router';
import { store } from '../store';
import { guarantee, planCards } from '../ui/components';
import { setTitle, toast } from '../util';

const ROWS: [string, string, string][] = [
  ['AI Foundations module (4 lessons)', '✓', '✓'],
  ['First lesson of every module', '✓', '✓'],
  ['All 40 lessons across 10 modules', '–', '✓'],
  ['Module quizzes with explanations', 'Module 1', 'All 10'],
  ['Completion certificate', '–', '✓'],
  ['Prompt library', 'Free prompts', '60+ prompts'],
  ['Automation playbooks', '3', 'All 10'],
  ['Prompt Builder, glossary & Tool Finder', '✓', '✓'],
  ['Progress dashboard, streaks & bookmarks', '✓', '✓'],
  ['New lessons and updates', '–', '✓'],
];

export default function pricing(el: HTMLElement, ctx: Ctx) {
  setTitle('Pricing', 'Simple pricing for Lumora: start free, or unlock every lesson, quiz, prompt and playbook with Pro.');
  if (ctx.query.get('canceled')) toast('Checkout canceled. No payment was taken.', 'info');
  const cfg = store.config;
  el.innerHTML = `
  <section class="container page-pad">
    <div class="section-head center-head">
      <span class="eyebrow">Pricing</span>
      <h1>Simple pricing. <span class="grad">Serious results.</span></h1>
      <p class="lead">Start free and learn the fundamentals. Go Pro for the full academy: every lesson, quiz, prompt and playbook, plus all future updates.</p>
      ${cfg?.billing_mode === 'demo' ? '<p class="demo-note">Demo mode: checkout is simulated and no card is charged.</p>' : ''}
    </div>
    ${cfg ? planCards(cfg.plans) : ''}
    ${guarantee()}
    <div class="compare card reveal">
      <h2>Compare plans</h2>
      <div class="table-wrap"><table class="compare-table">
        <thead><tr><th>Feature</th><th>Free</th><th>Pro</th></tr></thead>
        <tbody>${ROWS.map(([f, a, b]) => `<tr><td>${f}</td><td>${a}</td><td><strong>${b}</strong></td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="grid-3 pricing-notes">
      <div class="card reveal"><h3>Teams & companies</h3><p>Training 5+ people? We offer volume pricing, team onboarding and progress reports.</p><a class="btn btn-ghost btn-sm" href="/contact?topic=Teams%20%26%20companies">Talk to us</a></div>
      <div class="card reveal"><h3>Gift Lumora</h3><p>Know someone who'd love to finally "get" AI? Lifetime access makes a thoughtful gift.</p><a class="btn btn-ghost btn-sm" href="/contact?topic=Other">Send a gift</a></div>
      <div class="card reveal"><h3>Students & nonprofits</h3><p>Discounts available for students, teachers and registered nonprofits. Just ask.</p><a class="btn btn-ghost btn-sm" href="/contact?topic=Billing%20%26%20refunds">Request a discount</a></div>
    </div>
  </section>`;
}
