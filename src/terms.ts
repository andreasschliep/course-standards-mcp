/**
 * check_terms and lookup_term (design sections 6.3 and 6.4).
 *
 * check_terms searches a text for forms the term base marks as deprecated or wrong,
 * and with de-CH for every "ß". It never translates and never rewrites: each finding
 * names the form, where it is, what to write instead, and the source.
 *
 * Matching: case-insensitive, whole words, optional German or English inflection ending
 * (s, n, e, en, er, es), longest form first, no overlapping findings. Code spans, URLs
 * and the term's allow_in phrases are skipped.
 */
import { formsOf, type Severity, type Term, type Termbase } from './data/termbase.ts';
import { excerpt, fold } from './text.ts';

export type TermLanguage = 'en' | 'de' | 'de-CH';
export type TermCategory = 'deprecated' | 'keep_english' | 'wrong_translation' | 'locale';

export interface TermFinding {
  category: TermCategory;
  severity: Severity;
  found: string;
  line: number;
  column: number;
  excerpt: string;
  suggestion: string;
  term_id?: string;
  source?: string;
  note?: string;
}

interface Pattern {
  form: string;
  term: Term;
  category: TermCategory;
  severity: Severity;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The forms to look for in a text of this language. */
function patternsFor(termbase: Termbase, language: TermLanguage): Pattern[] {
  const german = language !== 'en';
  const patterns: Pattern[] = [];
  for (const term of termbase.terms) {
    for (const form of term.deprecated)
      patterns.push({ form, term, category: 'deprecated', severity: 'warn' });
    const wrongCategory: TermCategory = term.keep_english ? 'keep_english' : 'wrong_translation';
    for (const f of formsOf(term.wrong_en, term.severity)) {
      patterns.push({ form: f.form, term, category: 'wrong_translation', severity: f.severity });
    }
    if (german) {
      for (const f of formsOf(term.wrong_de, term.severity)) {
        patterns.push({ form: f.form, term, category: wrongCategory, severity: f.severity });
      }
    }
  }
  return patterns.sort((a, b) => b.form.length - a.form.length);
}

function regexFor(form: string): RegExp {
  const body = form.trim().split(/\s+/).map(escape).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}-])${body}(?:s|n|e|en|er|es)?(?![\\p{L}\\p{N}])`, 'giu');
}

/** Ranges that are not prose: inline code, fenced code, URLs. */
function maskedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const re of [/```[\s\S]*?```/g, /`[^`\n]*`/g, /\bhttps?:\/\/\S+/g]) {
    for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

const overlaps = (ranges: Array<[number, number]>, start: number, end: number) =>
  ranges.some(([a, b]) => start < b && end > a);

function position(text: string, index: number): { line: number; column: number; lineText: string } {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = text.indexOf('\n', index);
  return {
    line,
    column: index - lineStart + 1,
    lineText: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
  };
}

export function checkTerms(
  text: string,
  language: TermLanguage,
  termbase: Termbase,
  categories?: TermCategory[],
): TermFinding[] {
  const wanted = (c: TermCategory) => !categories?.length || categories.includes(c);
  const masked = maskedRanges(text);
  const taken: Array<[number, number]> = [];
  const findings: Array<TermFinding & { index: number }> = [];
  const german = language !== 'en';

  for (const p of patternsFor(termbase, language)) {
    if (!wanted(p.category)) continue;
    const allowed: Array<[number, number]> = [];
    for (const phrase of p.term.allow_in) {
      for (const m of text.matchAll(regexFor(phrase)))
        allowed.push([m.index, m.index + m[0].length]);
    }
    for (const m of text.matchAll(regexFor(p.form))) {
      const start = m.index;
      const end = start + m[0].length;
      if (
        overlaps(masked, start, end) ||
        overlaps(taken, start, end) ||
        overlaps(allowed, start, end)
      )
        continue;
      taken.push([start, end]);
      const pos = position(text, start);
      findings.push({
        index: start,
        category: p.category,
        severity: p.severity,
        found: m[0],
        line: pos.line,
        column: pos.column,
        excerpt: excerpt(pos.lineText, 120),
        suggestion: german ? p.term.de : p.term.en,
        term_id: p.term.id,
        source: p.term.source,
        ...(p.term.note ? { note: p.term.note } : {}),
      });
    }
  }

  if (language === 'de-CH' && wanted('locale')) {
    for (const m of text.matchAll(/[\p{L}-]*ß[\p{L}ß-]*/gu)) {
      if (overlaps(masked, m.index, m.index + m[0].length)) continue;
      const pos = position(text, m.index);
      findings.push({
        index: m.index,
        category: 'locale',
        severity: 'error',
        found: m[0],
        line: pos.line,
        column: pos.column,
        excerpt: excerpt(pos.lineText, 120),
        suggestion: m[0].replace(/ß/g, 'ss'),
        note: 'Swiss Standard German does not use ß.',
      });
    }
  }

  return findings.sort((a, b) => a.index - b.index).map(({ index: _index, ...f }) => f);
}

// ------------------------------------------------------------------------- lookup_term

export interface LookupEntry {
  id: string;
  en: string;
  de: string;
  de_variants: string[];
  keep_english: boolean;
  deprecated_forms: string[];
  wrong_translations: string[];
  matched_as: 'en' | 'de' | 'variant' | 'deprecated' | 'wrong';
  source: string;
  source_title: string;
  note?: string;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] ?? 0;
      row[j] = Math.min(
        current + 1,
        (row[j - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

export function lookupTerm(
  query: string,
  termbase: Termbase,
): { found: boolean; entries: LookupEntry[]; suggestions: string[] } {
  const q = fold(query.trim());
  const entries: LookupEntry[] = [];
  const allForms: string[] = [];
  for (const term of termbase.terms) {
    const wrong = [
      ...formsOf(term.wrong_de, term.severity),
      ...formsOf(term.wrong_en, term.severity),
    ].map((f) => f.form);
    const groups: Array<[LookupEntry['matched_as'], string[]]> = [
      ['en', [term.en]],
      ['de', [term.de]],
      ['variant', term.de_variants],
      ['deprecated', term.deprecated],
      ['wrong', wrong],
    ];
    allForms.push(term.en, term.de, ...term.de_variants);
    const hit = groups.find(([, forms]) => forms.some((f) => fold(f) === q));
    if (!hit) continue;
    entries.push({
      id: term.id,
      en: term.en,
      de: term.de,
      de_variants: term.de_variants,
      keep_english: term.keep_english,
      deprecated_forms: term.deprecated,
      wrong_translations: wrong,
      matched_as: hit[0],
      source: term.source,
      source_title: termbase.sources[term.source]?.title ?? term.source,
      ...(term.note ? { note: term.note } : {}),
    });
  }
  const suggestions = entries.length
    ? []
    : [...new Set(allForms)]
        .filter((f) => {
          const folded = fold(f);
          return (
            folded.startsWith(q) ||
            (q.length >= 4 && folded.includes(q)) ||
            editDistance(folded, q) <= 2
          );
        })
        .slice(0, 8);
  return { found: entries.length > 0, entries, suggestions };
}

// --------------------------------------------------------------- keywords for alignment

/**
 * German forms of the term-base terms that occur in an English objective, so a German
 * document can be searched with them ("Sprint Goal" → "Sprint-Ziel"). Design 5.4 (3).
 *
 * One group per term (official form first, then the accepted variants), so that the
 * variants of one term count as one hit. A term inside another matched term ("Sprint"
 * in "Sprint Goal") is dropped: it would match almost any Scrum text.
 */
export function germanFormsIn(englishText: string, termbase: Termbase): string[][] {
  const matched = termbase.terms.filter((t) => regexFor(t.en).test(englishText));
  const longer = (t: Term) =>
    matched.some((o) => o !== t && fold(o.en).includes(fold(t.en)) && o.en.length > t.en.length);
  const withoutArticle = (f: string) => f.replace(/^(der|die|das)(:\w+)?\s+/i, '');
  return matched
    .filter((t) => !longer(t))
    .map((t) => [...new Set([t.de, ...t.de_variants].map(withoutArticle))]);
}
