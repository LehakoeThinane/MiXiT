import type { FastifyPluginAsync } from 'fastify';

import { env } from '../../shared/config/env.js';

// Public, unauthenticated pages whose URLs go into App Store Connect and the Play
// Console (privacy policy, terms/EULA, account deletion, child safety standards,
// support). DRAFT TEXT — have it reviewed for POPIA/GDPR compliance before launch.

const LAST_UPDATED = '3 November 2026';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, body: string): string {
  const entity = escapeHtml(env.legalEntityName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · MiXiT</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px 20px 64px; line-height: 1.6; color: #1d2133; background: #fff; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 { font-size: 19px; margin-top: 32px; }
  .meta { color: #6b7088; font-size: 14px; }
  a { color: #e0531f; }
  nav a { margin-right: 14px; font-size: 14px; }
  @media (prefers-color-scheme: dark) { body { background: #0b0d18; color: #e6e9f5; } .meta { color: #9aa0bb; } a { color: #ff8a5c; } }
</style>
</head>
<body>
<nav><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/child-safety">Child safety</a><a href="/legal/delete-account">Delete account</a><a href="/legal/support">Support</a></nav>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${entity} · Last updated ${LAST_UPDATED}</p>
${body}
</body>
</html>`;
}

function contact(): string {
  const email = escapeHtml(env.supportEmail);
  return `<a href="mailto:${email}">${email}</a>`;
}

function privacyPolicy(): string {
  const entity = escapeHtml(env.legalEntityName);
  return page(
    'Privacy Policy',
    `
<p>This policy explains what personal information ${entity} ("MiXiT", "we") collects when you use the MiXiT app, why, and the choices you have. We process personal information in line with the Protection of Personal Information Act (POPIA) and, where applicable, the GDPR.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Account information</strong> — your email address and a unique account identifier from Google or Apple when you sign in. If you use "Hide My Email" with Apple, we receive a relay address instead.</li>
  <li><strong>Phone number</strong> (optional) — if you choose to add one. You control whether it is shown on your profile.</li>
  <li><strong>Profile information</strong> — display name, age, gender, bio, city, interests, intentions, conversation starters, photos and voice intro. Your profile is visible to other MiXiT users.</li>
  <li><strong>Precise location</strong> (optional) — only while you use the app and only if you allow it, to show approximate distance to other users. We never show your exact location to others. You can turn this off in your device settings at any time.</li>
  <li><strong>Messages and content</strong> — direct messages (text, photos and voice notes), messages you post in rooms, and the "vibes" you send and receive.</li>
  <li><strong>Safety information</strong> — users you block, reports you submit or that are submitted about you, and a copy of any message that is reported. Text you post is automatically checked against a list of prohibited terms (such as hate slurs) before it is published.</li>
  <li><strong>Purchases</strong> — records of subscriptions and in-app purchases (product, status, dates). Payments are processed by Apple, Google or PayFast; we never receive your card details.</li>
  <li><strong>Device and technical data</strong> — push notification token, IP address and device/app type for sign-in sessions, and crash and performance diagnostics.</li>
</ul>

<h2>How we use it</h2>
<ul>
  <li>To create and run your account and show your profile to other users.</li>
  <li>To suggest people in Discover (based on shared interests, intentions, activity and distance).</li>
  <li>To deliver messages and notifications.</li>
  <li>To provide purchased features such as MiXiT Premium and Vibe Boost.</li>
  <li>To keep MiXiT safe — investigating reports, enforcing our Terms and preventing abuse, fraud and underage use.</li>
  <li>To fix bugs and improve the app.</li>
</ul>
<p>We do not sell your personal information and we do not use it for third-party advertising.</p>

<h2>Who we share it with</h2>
<p>Other users see your profile and the content you send them. We use the following service providers, who process data on our behalf under contract: Supabase (database and file storage), our cloud hosting provider, Google and Apple (sign-in, in-app purchases), RevenueCat (purchase management), PayFast (web payments), Expo (push notifications) and Sentry (crash reporting). We may disclose information where required by law or to protect the safety of users or the public. Some providers store data outside South Africa; where they do, we rely on appropriate safeguards.</p>

<h2>How long we keep it</h2>
<p>We keep your information for as long as your account exists. When you delete your account, your profile, photos, voice intro, messages, vibes, room posts and purchase records are permanently deleted from our systems. Backups are overwritten within 30 days. We may keep limited records longer where the law requires it (for example, financial records) or to deal with a safety report.</p>

<h2>Your rights and choices</h2>
<ul>
  <li>Access, correct or update your information from the Profile tab.</li>
  <li>Delete your account at any time from <em>Profile → Delete account</em> (see <a href="/legal/delete-account">how to delete your account</a>).</li>
  <li>Turn off location or notifications in your device settings.</li>
  <li>Object to processing, or ask us for a copy of your information, by emailing ${contact()}.</li>
  <li>Complain to the Information Regulator of South Africa (inforegulator.org.za) if you believe we have mishandled your information.</li>
</ul>

<h2>Age requirement</h2>
<p>MiXiT is only for people aged 18 and over. We do not knowingly collect information from anyone under 18, and we remove accounts we believe belong to minors.</p>

<h2>Security</h2>
<p>Data is encrypted in transit (HTTPS) and access is restricted to authorised systems and staff. No system is perfectly secure, so please use a strong password for your Google or Apple account.</p>

<h2>Changes</h2>
<p>We will post updates here and, for significant changes, let you know in the app.</p>

<h2>Contact</h2>
<p>${entity} — ${contact()}</p>
`
  );
}

function termsOfUse(): string {
  const entity = escapeHtml(env.legalEntityName);
  return page(
    'Terms of Use',
    `
<p>These Terms are an agreement between you and ${entity}. By creating an account or using MiXiT you agree to them and to our <a href="/legal/privacy">Privacy Policy</a>.</p>

<h2>1. Eligibility</h2>
<p>You must be at least 18 years old and able to form a binding contract. You may only have one account, and the information you give us (including your age) must be accurate.</p>

<h2>2. Community rules — zero tolerance</h2>
<p>MiXiT has <strong>zero tolerance for objectionable content or abusive users</strong>. You must not post, send or share anything that:</p>
<ul>
  <li>involves or sexualises anyone under 18 in any way;</li>
  <li>is sexually explicit, pornographic or contains nudity;</li>
  <li>harasses, bullies, threatens, stalks or intimidates anyone;</li>
  <li>is hateful or discriminatory on the basis of race, ethnicity, religion, gender, sexual orientation, disability or any other characteristic;</li>
  <li>promotes violence, self-harm, terrorism or illegal activity (including drugs or weapons sales);</li>
  <li>is spam, a scam, a solicitation for money, or commercial advertising;</li>
  <li>impersonates another person or uses photos that are not of you;</li>
  <li>shares someone else's private information without consent.</li>
</ul>
<p>You can report or block any user at any time — from their profile, from the ⋯ menu in a chat, or by pressing and holding a message in a chat or room. Text containing prohibited terms is blocked automatically. We review reports within 24 hours, remove violating content and suspend or permanently ban the users responsible. Where content involves child sexual abuse or exploitation we report it to the relevant authorities.</p>

<h2>3. Your content</h2>
<p>You own the content you post. You give us a non-exclusive, worldwide, royalty-free licence to host, store, display and transmit it solely to operate MiXiT. You are responsible for your content and your interactions with other users.</p>

<h2>4. Meeting people safely</h2>
<p>We do not conduct criminal background checks on users. Use caution when communicating with or meeting people you met on MiXiT: meet in public, tell a friend where you are going, and never send money to someone you have met online.</p>

<h2>5. Purchases and subscriptions</h2>
<ul>
  <li><strong>MiXiT Premium</strong> is an auto-renewing monthly subscription. Payment is charged to your Apple ID or Google Play account at confirmation of purchase. It renews automatically unless cancelled at least 24 hours before the end of the current period, and your account is charged for renewal within 24 hours before the period ends.</li>
  <li>You can manage or cancel your subscription in your App Store or Google Play account settings. Cancelling stops future renewals; you keep Premium until the end of the period you paid for. Deleting the MiXiT app or your account does not cancel a store subscription.</li>
  <li><strong>Vibe Boost</strong> is a one-off purchase that is used up when activated.</li>
  <li>Refunds for App Store or Google Play purchases are handled by Apple or Google under their refund policies. Your statutory rights under the Consumer Protection Act are not affected.</li>
  <li>Prices are shown in the app before you buy and may change; changes never affect a period you have already paid for.</li>
</ul>

<h2>6. Ending your account</h2>
<p>You may delete your account at any time from the Profile tab. We may suspend or terminate your account if you break these Terms or put other users at risk.</p>

<h2>7. Disclaimers and liability</h2>
<p>MiXiT is provided "as is". To the extent permitted by law, we are not liable for the conduct of any user, on or off the app, or for indirect or consequential losses. Nothing in these Terms limits liability that cannot be limited by law.</p>

<h2>8. Apple</h2>
<p>If you downloaded MiXiT from the App Store, these Terms are between you and ${entity}, not Apple. Apple has no obligation to provide support or maintenance, is not responsible for any claims relating to the app, and is a third-party beneficiary of these Terms entitled to enforce them against you. Apple's Standard Licensed Application End User License Agreement also applies to the extent these Terms do not cover something.</p>

<h2>9. General</h2>
<p>These Terms are governed by the laws of the Republic of South Africa. We may update them; continuing to use MiXiT after an update means you accept the new Terms.</p>

<h2>Contact</h2>
<p>${contact()}</p>
`
  );
}

function deleteAccountPage(): string {
  return page(
    'Delete your MiXiT account',
    `
<h2>Delete in the app (fastest)</h2>
<ol>
  <li>Open MiXiT and go to the <strong>Profile</strong> tab.</li>
  <li>Scroll down and tap <strong>Delete account</strong>.</li>
  <li>Confirm. Your account is deleted immediately.</li>
</ol>

<h2>Can't access the app?</h2>
<p>Email ${contact()} from the email address linked to your account with the subject "Delete my account". We will verify the request and delete your account within 7 days.</p>

<h2>What gets deleted</h2>
<p>Your account, profile, photos, voice intro, direct messages and media, room messages, vibes, blocks and reports you made, and purchase records are permanently deleted. Backups are overwritten within 30 days. We may keep limited information where legally required, or records of reports about you where needed to keep other users safe.</p>

<h2>Subscriptions</h2>
<p>Deleting your account does <strong>not</strong> cancel an App Store or Google Play subscription. Cancel it in your Apple ID or Google Play subscription settings to stop being charged.</p>
`
  );
}

function childSafetyPage(): string {
  const entity = escapeHtml(env.legalEntityName);
  return page(
    'Child Safety Standards',
    `
<p>${entity} prohibits child sexual abuse and exploitation (CSAE) and child sexual abuse material (CSAM) on MiXiT.</p>

<h2>Our standards</h2>
<ul>
  <li>MiXiT is strictly for adults aged 18 and over. Users must confirm they are 18+ to create an account, and accounts reported as underage are immediately hidden from other users until our team has reviewed them, and removed if they belong to a minor.</li>
  <li>Any content or behaviour that sexualises, grooms, endangers or exploits a minor is banned. Accounts involved are permanently removed.</li>
  <li>Users can report any profile, chat message or room message in the app (choose "Appears to be under 18" or "Inappropriate or sexual content"). Reports are reviewed by our team within 24 hours, and underage reports are prioritised.</li>
  <li>Text that contains known child-exploitation terms is blocked automatically before it can be sent.</li>
  <li>We report apparent CSAM and child exploitation to the South African Police Service and other relevant authorities, and preserve evidence as required by law, including the Films and Publications Act and the Criminal Law (Sexual Offences and Related Matters) Amendment Act.</li>
</ul>

<h2>Contact for child safety concerns</h2>
<p>Our designated child-safety contact can be reached at ${contact()}. If a child is in immediate danger, contact SAPS on 10111 or Childline South Africa on 116.</p>
`
  );
}

function supportPage(): string {
  return page(
    'Support',
    `
<p>Need help with MiXiT? Email ${contact()} and we'll get back to you within 2 business days.</p>
<h2>Safety</h2>
<p>To report someone, open their profile or a chat and tap <strong>⋯</strong>, or press and hold one of their messages, then choose <strong>Report</strong>. You can also block them (and unblock people from <em>Profile → Blocked users</em>) so you won't see each other again. If you are in danger, contact SAPS on 10111.</p>
<h2>Subscriptions</h2>
<p>Manage or cancel MiXiT Premium in your App Store or Google Play subscription settings. Use <strong>Restore purchases</strong> on the Premium screen if a purchase isn't showing.</p>
<h2>Account</h2>
<p>See <a href="/legal/delete-account">how to delete your account</a>.</p>
`
  );
}

const legalRoutes: FastifyPluginAsync = async (fastify) => {
  const pages: Record<string, () => string> = {
    '/privacy': privacyPolicy,
    '/terms': termsOfUse,
    '/delete-account': deleteAccountPage,
    '/child-safety': childSafetyPage,
    '/support': supportPage,
  };

  for (const [path, render] of Object.entries(pages)) {
    fastify.get(path, async (_req, reply) => reply.type('text/html; charset=utf-8').send(render()));
  }
};

export default legalRoutes;
