// Server-side filter for objectionable text (App Store guideline 1.2 requires "a
// method for filtering objectionable material" in apps with user-generated content).
//
// Deliberately narrow: it blocks the categories that are never acceptable —
// hate slurs, child sexual exploitation terms and incitement to self-harm — and
// leaves ordinary profanity/flirting alone. Everything else is handled by user
// reports + the admin review queue. Extend the patterns as moderation data comes in.

type Category = 'hate' | 'child_safety' | 'self_harm';

const PATTERNS: { category: Category; pattern: RegExp }[] = [
  // Hate slurs (including South African ones)
  { category: 'hate', pattern: /\bnigg(?:er|a|ah|uh)s?\b/ },
  { category: 'hate', pattern: /\bk+a+f+[ie]+r+s?\b/ },
  { category: 'hate', pattern: /\bhotnots?\b/ },
  { category: 'hate', pattern: /\bfaggots?\b/ },
  { category: 'hate', pattern: /\btrann(?:y|ies)\b/ },
  { category: 'hate', pattern: /\bkikes?\b/ },
  { category: 'hate', pattern: /\bchinks?\b/ },
  { category: 'hate', pattern: /\bspics?\b/ },
  { category: 'hate', pattern: /\bwetbacks?\b/ },
  { category: 'hate', pattern: /\bcoolies?\b/ },
  // Child sexual exploitation
  { category: 'child_safety', pattern: /\bchild ?porn\w*\b/ },
  { category: 'child_safety', pattern: /\bkiddie ?porn\b/ },
  { category: 'child_safety', pattern: /\bjail ?bait\b/ },
  { category: 'child_safety', pattern: /\blolicon\b/ },
  { category: 'child_safety', pattern: /\bpre ?teen (?:sex|nudes?|pics?)\b/ },
  { category: 'child_safety', pattern: /\bunder ?age (?:sex|nudes?|pics?|girls?|boys?)\b/ },
  { category: 'child_safety', pattern: /\bcsam\b/ },
  { category: 'child_safety', pattern: /\bpa?edo(?:phile)?s?\b/ },
  // Incitement to self-harm
  { category: 'self_harm', pattern: /\bkill (?:yo)?urself\b/ },
  { category: 'self_harm', pattern: /\bkys\b/ },
  { category: 'self_harm', pattern: /\bgo die\b/ },
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  '$': 's',
  '7': 't',
};

/** Lower-case, undo common leetspeak, strip accents and collapse separators. */
export function normalizeForFilter(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // combining accents left by NFKD
    .replace(/[0-9@$]/g, (ch) => LEET[ch] ?? ch)
    .replace(/[^a-z\s]+/g, '') // "n.i.g" / "k*ffir" style separators
    .replace(/\s+/g, ' ')
    .trim();
}

export type FilterResult = { ok: true } | { ok: false; category: Category };

export function checkText(...texts: (string | null | undefined)[]): FilterResult {
  for (const text of texts) {
    if (!text) continue;
    const normalized = normalizeForFilter(text);
    for (const { category, pattern } of PATTERNS) {
      if (pattern.test(normalized)) return { ok: false, category };
    }
  }
  return { ok: true };
}

export const FILTERED_MESSAGE =
  "This contains language that isn't allowed on MiXiT. Please keep it respectful — see our Terms of Use.";
