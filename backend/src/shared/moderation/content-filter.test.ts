import { describe, expect, it } from 'vitest';

import { checkText, normalizeForFilter } from './content-filter.js';

describe('content filter', () => {
  it('allows ordinary conversation', () => {
    expect(checkText('Hey! Want to grab coffee in Soweto this weekend?')).toEqual({ ok: true });
    expect(checkText('That match was damn good', 'Skilled at specifics')).toEqual({ ok: true });
  });

  it('blocks slurs including leetspeak and separators', () => {
    expect(checkText('you k4ffir')).toEqual({ ok: false, category: 'hate' });
    expect(checkText('f.a.g.g.o.t')).toEqual({ ok: false, category: 'hate' });
  });

  it('blocks child-safety and self-harm terms', () => {
    expect(checkText('selling jailbait pics')).toEqual({ ok: false, category: 'child_safety' });
    expect(checkText('just kys')).toEqual({ ok: false, category: 'self_harm' });
  });

  it('checks every provided field', () => {
    expect(checkText(null, 'fine', 'kill urself').ok).toBe(false);
  });

  it('normalizes accents and leetspeak', () => {
    expect(normalizeForFilter('H3LL0 Wörld!!')).toBe('hello world');
  });
});
