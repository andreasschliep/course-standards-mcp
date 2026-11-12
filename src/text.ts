/**
 * Word matching for activity cues and keywords, in German and English.
 *
 * Text and cues are folded the same way: lower case, umlauts as ae/oe/ue, ß as ss.
 * "Übung", "Uebung" and "übung" then all become "uebung".
 *
 * A cue is one word ("Übung") or a phrase ("case study"). One word matches a token
 * - exactly,
 * - as a prefix of the token ("Übungen", "practising"), or, for German cues,
 * - as the end of the token (a compound such as "Partnerübung").
 * Prefix and suffix rules only apply to cues of four or more characters.
 * A phrase must match consecutive tokens exactly.
 */

export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/** Words: letters and digits, hyphens inside a word kept ("check-in", "peer-review"). */
export function tokens(text: string): string[] {
  return fold(text).match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

export type CueLanguage = 'de' | 'en';

export interface Cue {
  /** As written in the data file, for reporting. */
  label: string;
  words: string[];
  language: CueLanguage;
}

export function makeCue(label: string, language: CueLanguage): Cue {
  return { label, words: tokens(label), language };
}

function wordMatches(cue: string, token: string, language: CueLanguage): boolean {
  if (token === cue) return true;
  if (cue.length < 4) return false;
  if (token.startsWith(cue)) return true;
  return language === 'de' && token.endsWith(cue);
}

/** True when the cue occurs in the token list. */
export function cueMatches(cue: Cue, toks: string[]): boolean {
  const [first, ...rest] = cue.words;
  if (first === undefined) return false;
  if (rest.length === 0) return toks.some((t) => wordMatches(first, t, cue.language));
  for (let i = 0; i + cue.words.length <= toks.length; i++) {
    if (cue.words.every((w, j) => toks[i + j] === w)) return true;
  }
  return false;
}

/** Shortens a passage to a one-line excerpt. */
export function excerpt(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}
