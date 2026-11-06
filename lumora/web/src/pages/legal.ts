import type { Ctx } from '../router';
import { setTitle } from '../util';

const TERMS = `
<h2>1. The service</h2><p>Lumora provides online educational content about using artificial-intelligence tools ("the Service"). Content is for general educational purposes and is not legal, medical, financial or other professional advice.</p>
<h2>2. Accounts</h2><p>You are responsible for keeping your login details secure and for activity on your account. You must provide accurate information and be old enough to form a binding contract where you live.</p>
<h2>3. Plans, billing and cancellation</h2><p>Paid plans are billed in advance. Monthly and yearly subscriptions renew automatically until cancelled. You can cancel at any time from your account; access continues until the end of the paid period. Lifetime plans are a one-time payment. We offer a 14-day money-back guarantee on first purchases.</p>
<h2>4. Acceptable use</h2><p>Don't share your account, resell or republish Lumora content, or attempt to disrupt or reverse-engineer the Service.</p>
<h2>5. Intellectual property</h2><p>Lumora content is owned by Lumora or its licensors. You may use prompts and templates for your own personal and business purposes.</p>
<h2>6. Third-party tools</h2><p>Lessons refer to third-party AI products. We are not responsible for their availability, pricing, terms or outputs. Always verify important information.</p>
<h2>7. Liability</h2><p>To the extent permitted by law, the Service is provided "as is" and our total liability is limited to the amount you paid us in the 12 months before a claim.</p>
<h2>8. Changes</h2><p>We may update these terms and will notify members of material changes.</p>`;

const PRIVACY = `
<h2>What we collect</h2><p>Your name, email address, a securely hashed password, your learning progress (lessons completed, quiz scores, saved items) and your plan status. If you join our email list, we store your email address and where you signed up.</p>
<h2>Payments</h2><p>Payments are processed by our payment provider (Stripe). We never see or store your full card number. We store a customer reference so you can manage billing.</p>
<h2>How we use it</h2><p>To run your account, save your progress, process payments, send service emails and improve Lumora. We don't sell your personal data.</p>
<h2>Cookies</h2><p>We use a single essential, HTTP-only session cookie to keep you signed in. We store your theme preference in your browser. No advertising trackers.</p>
<h2>Your rights</h2><p>You can export all your data or permanently delete your account at any time from the Account page. Contact us for any other request.</p>
<h2>Security</h2><p>Passwords are hashed with Argon2id, sessions are stored server-side and can be revoked, and all traffic is encrypted in transit.</p>
<h2>Contact</h2><p>Questions? Email privacy@lumora.app.</p>`;

export default function legal(el: HTMLElement, ctx: Ctx) {
  const terms = ctx.path === '/terms';
  setTitle(terms ? 'Terms of Service' : 'Privacy Policy');
  el.innerHTML = `<section class="container narrow page-pad"><span class="eyebrow">Legal</span><h1>${terms ? 'Terms of Service' : 'Privacy Policy'}</h1><p class="muted">Last updated: ${new Date(2026, 9, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p><div class="prose card">${terms ? TERMS : PRIVACY}</div></section>`;
}
