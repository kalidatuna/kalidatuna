import { ApiError, post } from '../api';
import { navigate } from '../router';
import { store } from '../store';
import { guarantee, model3d, moduleCard, planCards } from '../ui/components';
import { esc, setTitle, toast } from '../util';

const BEFORE_AFTER = [
  {
    label: 'Tricky email',
    before: 'Write an email to my landlord.',
    after: `Background: The kitchen tap has leaked for 2 weeks. I reported it by phone on the 3rd. I've rented here 4 years and always paid on time.
Role: Act as a calm, professional letter writer.
Intent: Get the tap repaired this week without souring the relationship.
Format: Under 120 words. Friendly but firm. Propose two times I'm home.`,
    result: 'A clear, polite email with dates, a specific ask and a deadline. Ready to send after a quick read.',
  },
  {
    label: 'Meal planning',
    before: 'Give me some dinner ideas.',
    after: `Plan 5 weeknight dinners for 2 adults and 2 kids (6 and 9, one hates spicy food). Budget about $90. Max 30 minutes cooking. We have a slow cooker. Reuse ingredients to cut waste, then give me one shopping list grouped by aisle.`,
    result: 'A realistic week of meals your family will eat, plus a shopping list sorted the way you walk the store.',
  },
  {
    label: 'Automation',
    before: 'How do I automate stuff?',
    after: `Here are tasks I do weekly: [list]. Score each on frequency, boredom, how rule-based it is and risk. Rank them. For the top 2, describe the trigger and actions for a no-code automation and the easiest tool for a beginner.`,
    result: 'Your personal automation shortlist, with step-by-step blueprints you can build that afternoon.',
  },
];

const PERSONAS = [
  ['Busy parents', 'Meal plans, school admin, family calendars and homework help (the tutor kind, not the cheating kind).', '#ffb85c'],
  ['Office workers', 'Emails, meetings, documents and spreadsheets in half the time, using your company\'s approved tools.', '#4fe3b0'],
  ['Small business owners', 'Customer replies, marketing content and automations that give you your evenings back.', '#7ee081'],
  ['Retirees & the curious', 'Patient, jargon-free guidance, with extra care around privacy, scams and voice cloning.', '#5ce1e6'],
  ['Freelancers & side-hustlers', 'Deliver faster, package AI services, and avoid the "get rich quick" traps.', '#ff7ad9'],
  ['Students & lifelong learners', 'Study plans, quizzes and explanations at exactly your level.', '#8b7bff'],
];

const FAQ = [
  ['Do I need any technical skills?', 'None. If you can send an email, you can do everything in Lumora. Every lesson is written in plain English with copy-and-paste prompts, and the automation playbooks walk you through every click.'],
  ['Which AI app do I need?', 'Any of the major assistants works: ChatGPT, Claude, Gemini or Copilot. Free versions are fine to start. Lesson 3 helps you choose, and nothing in Lumora locks you into one tool.'],
  ['AI changes every week. Will this be out of date?', 'We teach durable skills (briefing, iterating, verifying, automating) that work across tools, and we review lessons regularly as products change. Pro members get every update included.'],
  ['What do I get for free?', 'The entire AI Foundations module, the first lesson of every other module, free prompts, the glossary, the Tool Finder, the Prompt Builder, the AI Starter Kit and 3 automation playbooks. No card required.'],
  ['Can I cancel any time?', 'Yes. Monthly and yearly plans can be cancelled from your account page in two clicks, and you keep access until the end of the period you paid for. There\'s also a 14-day money-back guarantee.'],
  ['What\'s the difference between yearly and lifetime?', 'Yearly renews each year at a big discount on monthly. Lifetime is a single payment for permanent access to everything, including all future lessons and playbooks.'],
  ['Is my data safe?', 'We store only what we need to run your account: your name, email and learning progress. Passwords are hashed with Argon2, payments are handled by our payment provider, and you can export or delete your data at any time.'],
  ['Do you offer team or company plans?', 'Yes. For teams of 5 or more, email us for volume pricing, team onboarding and progress reporting.'],
];

export default function landing(el: HTMLElement) {
  setTitle('', 'Lumora teaches regular people to use AI for real life: prompting, skills, automation, creativity and safety. Start free.');
  const cfg = store.config;
  const s = cfg?.stats;
  const modules = cfg?.modules ?? [];
  const yearly = cfg?.plans.find((p) => p.id === 'yearly');
  el.innerHTML = `
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <a class="pill reveal" href="/learn/what-are-ai-skills"><span class="pill-dot"></span>New: Skills, Agents & Automation modules</a>
        <h1 class="display reveal">AI, finally explained in <span class="grad">plain English</span>.</h1>
        <p class="lead reveal">Lumora is the friendly, practical academy that teaches regular people to use AI for real life: emails, planning, work, custom assistants and no-code automation. No jargon, no hype. Just skills you'll use this week.</p>
        <div class="hero-ctas reveal">
          <a class="btn btn-primary btn-lg" href="${store.user ? '/dashboard' : '/signup'}">${store.user ? 'Continue learning' : 'Start free, no card needed'}</a>
          <a class="btn btn-ghost btn-lg" href="/learn/what-ai-really-is">Read lesson 1 →</a>
        </div>
        <ul class="hero-stats reveal" aria-label="What's inside">
          <li><strong>${s?.lessons ?? 40}</strong><span>bite-size lessons</span></li>
          <li><strong>${s?.prompts ?? 60}+</strong><span>ready-to-use prompts</span></li>
          <li><strong>${s?.playbooks ?? 10}</strong><span>automation playbooks</span></li>
          <li><strong>${Math.floor((s?.minutes ?? 360) / 60)}h+</strong><span>of guided practice</span></li>
        </ul>
      </div>
      <div class="hero-visual" data-hover-host>
        ${model3d('hero', '#8b7bff', 'model-hero')}
        <div class="float-card fc-1 glass"><span class="fc-icon">✦</span><div><strong>Prompt copied</strong><span>“Calm reply to a difficult message”</span></div></div>
        <div class="float-card fc-2 glass"><span class="fc-icon fc-green">✓</span><div><strong>Automation live</strong><span>Receipts → spending sheet</span></div></div>
        <div class="float-card fc-3 glass"><span class="fc-icon fc-gold">🔥</span><div><strong>7-day streak</strong><span>Module 4 · AI at Work</span></div></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head reveal"><span class="eyebrow">Sound familiar?</span><h2>Everyone says AI will change everything.<br/>Nobody shows you <em>how</em>.</h2></div>
      <div class="grid-3">
        <div class="card pain reveal"><span class="pain-emoji">😐</span><h3>“I tried it once. The answer was bland.”</h3><p>Most people type five words and give up. The difference is knowing how to brief it, and that takes ten minutes to learn.</p></div>
        <div class="card pain reveal"><span class="pain-emoji">🤯</span><h3>“There are a hundred tools. Where do I start?”</h3><p>You don't need a hundred. You need one assistant, a handful of habits and a clear path. We give you exactly that.</p></div>
        <div class="card pain reveal"><span class="pain-emoji">😟</span><h3>“What about privacy, scams and mistakes?”</h3><p>Healthy caution is smart. You'll learn what never to share, how to spot made-up answers and how to protect your family from AI scams.</p></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head reveal"><span class="eyebrow">See the difference</span><h2>The same AI. A completely different answer.</h2><p class="lead">Lumora teaches the <strong>BRIEF</strong> method: background, role, intent, examples, format. Watch what it does to an everyday request.</p></div>
      <div class="ba card reveal">
        <div class="ba-tabs" role="tablist">${BEFORE_AFTER.map((b, i) => `<button role="tab" class="chip ${i === 0 ? 'active' : ''}" data-ba="${i}" aria-selected="${i === 0}">${esc(b.label)}</button>`).join('')}</div>
        <div class="ba-grid">
          <div class="ba-col ba-before"><span class="ba-tag">Before</span><pre data-ba-before></pre><p class="ba-note">Result: generic, forgettable, needs rewriting.</p></div>
          <div class="ba-arrow" aria-hidden="true">→</div>
          <div class="ba-col ba-after"><span class="ba-tag ba-tag-good">After Lumora</span><pre data-ba-after></pre><p class="ba-note" data-ba-result></p></div>
        </div>
        <div class="ba-foot"><a class="btn btn-secondary btn-sm" href="/prompt-builder">Try the free Prompt Builder</a><span class="muted">Works in ChatGPT, Claude, Gemini, Copilot and more.</span></div>
      </div>
    </div>
  </section>

  <section class="section" id="curriculum">
    <div class="container">
      <div class="section-head reveal"><span class="eyebrow">The curriculum</span><h2>Ten modules. From “what is AI?” to building your own automations.</h2><p class="lead">Each lesson takes 7–12 minutes and ends with something you can do right away. Every module finishes with a quiz.</p></div>
      <div class="module-grid">${modules.map((m, i) => moduleCard(m, i)).join('')}</div>
      <div class="center reveal"><a class="btn btn-ghost" href="/learn">Explore every lesson →</a></div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head reveal"><span class="eyebrow">Inside Lumora</span><h2>Everything you need, in one calm place</h2></div>
      <div class="bento">
        <a class="bento-card b-wide card reveal" href="/learn" data-hover-host>
          ${model3d('book', '#8b7bff', 'model-bento')}
          <div><h3>Lessons that respect your time</h3><p>Plain-English explanations, real examples and a “try it now” exercise in every lesson. Progress saves automatically.</p></div>
        </a>
        <a class="bento-card card reveal" href="/prompts" data-hover-host>
          ${model3d('sparkle', '#ff7ad9', 'model-bento')}
          <div><h3>${s?.prompts ?? 60}+ copy-paste prompts</h3><p>For emails, money, work, family, health, learning and business. One click to copy.</p></div>
        </a>
        <a class="bento-card card reveal" href="/playbooks" data-hover-host>
          ${model3d('gears', '#ffd166', 'model-bento')}
          <div><h3>Automation playbooks</h3><p>Step-by-step builds: receipt tracker, inbox digest, enquiry handler and more.</p></div>
        </a>
        <a class="bento-card card reveal" href="/tools" data-hover-host>
          ${model3d('compass', '#5cc8ff', 'model-bento')}
          <div><h3>Tool Finder</h3><p>${s?.tools ?? 30} hand-picked AI tools, explained honestly, with free-tier info.</p></div>
        </a>
        <a class="bento-card card reveal" href="/prompt-builder" data-hover-host>
          ${model3d('bubble', '#5cc8ff', 'model-bento')}
          <div><h3>Prompt Builder</h3><p>Fill in a few boxes, get a great prompt. Scores your prompt and suggests fixes.</p></div>
        </a>
        <a class="bento-card card reveal" href="/glossary" data-hover-host>
          ${model3d('orb', '#8b7bff', 'model-bento')}
          <div><h3>Plain-English glossary</h3><p>${s?.terms ?? 50} AI terms explained like a friend would: tokens, agents, MCP and more.</p></div>
        </a>
        <a class="bento-card b-wide card reveal" href="/dashboard" data-hover-host>
          ${model3d('trophy', '#ffd166', 'model-bento')}
          <div><h3>Quizzes, streaks & a certificate</h3><p>${s?.quiz_questions ?? 50} quiz questions with explanations, a progress dashboard that keeps you motivated, and a shareable certificate when you finish.</p></div>
        </a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head reveal"><span class="eyebrow">How it works</span><h2>Learn it. Use it. Keep it.</h2></div>
      <ol class="steps">
        <li class="card reveal"><span class="step-n">1</span><h3>Learn in 10 minutes</h3><p>Short lessons with one clear idea each. Read on your phone over coffee.</p></li>
        <li class="card reveal"><span class="step-n">2</span><h3>Use it the same day</h3><p>Every lesson ends with a prompt you copy into your own AI assistant for a real task.</p></li>
        <li class="card reveal"><span class="step-n">3</span><h3>Build systems that last</h3><p>Turn what works into reusable skills, custom assistants and automations that save hours every week.</p></li>
      </ol>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head reveal"><span class="eyebrow">Who it's for</span><h2>Made for regular people, not engineers</h2></div>
      <div class="grid-3 personas">${PERSONAS.map(([t, d, c]) => `<div class="card persona reveal" style="--c:${c}"><span class="persona-dot"></span><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
    </div>
  </section>

  <section class="section" id="pricing">
    <div class="container">
      <div class="section-head reveal"><span class="eyebrow">Pricing</span><h2>Start free. Upgrade when you're hooked.</h2><p class="lead">Less than a takeaway coffee a week on the yearly plan${yearly ? ` (${esc((yearly.price_cents / 100 / 52).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))}/week)` : ''}.</p></div>
      ${cfg ? planCards(cfg.plans) : ''}
      ${guarantee()}
    </div>
  </section>

  <section class="section">
    <div class="container narrow">
      <div class="section-head reveal"><span class="eyebrow">Questions</span><h2>Frequently asked</h2></div>
      <div class="faq">${FAQ.map(([q, a]) => `<details class="card reveal"><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="cta-band card reveal" data-hover-host>
        <div>
          <span class="eyebrow">Free download</span>
          <h2>Get the AI Starter Kit</h2>
          <p>Our 10 most useful prompts, a privacy checklist and a 7-day plan to build your AI habit. Free, instantly.</p>
          <form class="lead-form" novalidate>
            <label class="sr-only" for="lead-email">Email address</label>
            <input id="lead-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" required />
            <button class="btn btn-primary" type="submit">Send me the kit</button>
          </form>
          <p class="fine">No spam. Unsubscribe any time.</p>
        </div>
        ${model3d('rocket', '#b48cff', 'model-cta')}
      </div>
    </div>
  </section>`;

  // Before/after switcher
  const setBA = (i: number) => {
    const b = BEFORE_AFTER[i];
    el.querySelector('[data-ba-before]')!.textContent = b.before;
    el.querySelector('[data-ba-after]')!.textContent = b.after;
    el.querySelector('[data-ba-result]')!.textContent = `Result: ${b.result}`;
    el.querySelectorAll<HTMLButtonElement>('[data-ba]').forEach((t) => {
      const on = Number(t.dataset.ba) === i;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
  };
  setBA(0);
  el.querySelectorAll<HTMLButtonElement>('[data-ba]').forEach((t) => t.addEventListener('click', () => setBA(Number(t.dataset.ba))));

  // Lead capture
  const form = el.querySelector<HTMLFormElement>('.lead-form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input')!;
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    try {
      await post('/leads', { email: input.value, source: 'landing-kit' });
      toast('Your Starter Kit is ready!');
      navigate('/starter-kit');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}
