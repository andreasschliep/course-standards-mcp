/**
 * Facilitation plans and course descriptions in Markdown.
 *
 * A plan is split into sections by its headings. A section runs until the next heading
 * of the same or a higher level, so it includes its sub-sections. Then (design 5.3):
 * - a section that cites objectives itself, and has no sub-section that does, is one
 *   activity, including the text of its sub-sections ("2.3" with "Phase 1", "Phase 2");
 * - a section that has a time but cites nothing, and has neither an ancestor nor a
 *   descendant that cites objectives, is an activity without objectives (check-in,
 *   buffer); breaks are recognised and set aside;
 * - everything else is structure (title, "Preparation", "Day 1").
 *
 * Minutes come from the heading or the section's first line, never from deeper text,
 * so the times of sub-steps are not mistaken for the block's time.
 */
import type { ReferenceConfig } from '../data/catalogs.ts';
import type { Rubric } from '../data/rubric.ts';
import { classify, type Activity } from './activities.ts';
import { findReferences } from './references.ts';

interface Section {
  level: number;
  title: string;
  start: number; // 0-based line index of the heading
  end: number; // exclusive
  ownEnd: number; // end of the text before the first sub-section
  children: Section[];
  parent: Section | null;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function parseSections(lines: string[]): Section[] {
  const all: Section[] = [];
  const stack: Section[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (!m) return;
    const level = (m[1] ?? '#').length;
    while (stack.length && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
    const parent = stack.at(-1) ?? null;
    const section: Section = {
      level,
      title: m[2] ?? '',
      start: i,
      end: lines.length,
      ownEnd: lines.length,
      children: [],
      parent,
    };
    parent?.children.push(section);
    all.push(section);
    stack.push(section);
  });
  for (const s of all) {
    const next = all.find((o) => o.start > s.start && o.level <= s.level);
    s.end = next ? next.start : lines.length;
    s.ownEnd = s.children[0]?.start ?? s.end;
  }
  return all;
}

/** "45 min", "30 Min.", "30 Minuten", "15'"; else a time range "09:00–09:30". */
export function findMinutes(text: string): number | null {
  const explicit = /(\d{1,3})\s*(?:min(?:uten|utes|\.)?|’|')(?![\p{L}])/iu.exec(text);
  if (explicit) return Number(explicit[1]);
  const range = /(\d{1,2})[:.](\d{2})\s*[-‐‑–—]\s*(\d{1,2})[:.](\d{2})/.exec(text);
  if (range) {
    const [, h1, m1, h2, m2] = range.map(Number) as [number, number, number, number, number];
    const minutes = h2 * 60 + m2 - (h1 * 60 + m1);
    if (minutes > 0 && minutes <= 600) return minutes;
  }
  return null;
}

const PHASES: Array<[RegExp, string]> = [
  [/\bC1\b|\bConnections\b/i, 'C1'],
  [/\bC2\b|\bConcepts\b/i, 'C2'],
  [/\bC3\b|\bConcrete Practice\b/i, 'C3'],
  [/\bC4\b|\bConclusions\b/i, 'C4'],
];

function findPhase(text: string): string | null {
  for (const [re, phase] of PHASES) if (re.test(text)) return phase;
  return null;
}

/** "line 5" or "lines 24-28" (1-based), without trailing blank lines. */
export function lineRange(lines: string[], from: number, to: number): string {
  let last = to - 1;
  while (last > from && (lines[last] ?? '').trim() === '') last--;
  return last === from ? `line ${from + 1}` : `lines ${from + 1}-${last + 1}`;
}

/** The meaningful first line of a section's own text (skips blank lines and HTML comments). */
function firstLine(lines: string[], from: number, to: number): string {
  for (let i = from; i < to; i++) {
    const line = (lines[i] ?? '').trim();
    if (line && !line.startsWith('<!--')) return line;
  }
  return '';
}

export function extractPlan(
  markdown: string,
  references: ReferenceConfig,
  known: Set<string>,
  rubric: Rubric,
): Activity[] {
  const lines = markdown.split(/\r?\n/);
  const sections = parseSections(lines);
  const own = new Map(
    sections.map((s) => {
      const ownText = [s.title, ...lines.slice(s.start + 1, s.ownEnd)].join('\n');
      return [s, findReferences(ownText, references, known)];
    }),
  );
  const cites = (s: Section) => {
    const r = own.get(s);
    return Boolean(r && (r.ids.length || r.unknown.length));
  };
  const descendantCites = (s: Section): boolean =>
    s.children.some((c) => cites(c) || descendantCites(c));
  const ancestorCites = (s: Section): boolean =>
    s.parent ? cites(s.parent) || ancestorCites(s.parent) : false;
  const inheritedPhase = (s: Section | null): string | null =>
    s ? (findPhase(s.title) ?? inheritedPhase(s.parent)) : null;

  const activities: Activity[] = [];
  for (const s of sections) {
    const headLine = firstLine(lines, s.start + 1, s.ownEnd);
    const ownMinutes = findMinutes(s.title) ?? findMinutes(headLine);
    const isActivity = cites(s)
      ? !descendantCites(s)
      : ownMinutes !== null &&
        !descendantCites(s) &&
        !ancestorCites(s) &&
        s.children.every((c) => findMinutes(c.title) === null);
    if (!isActivity) continue;

    const body = lines
      .slice(s.start + 1, s.end)
      .join('\n')
      .trim();
    const text = `${s.title}\n${body}`;
    const refs = own.get(s) ?? { ids: [], unknown: [] };
    const kind = classify(text, rubric);
    const childMinutes = s.children
      .map((c) => findMinutes(c.title))
      .filter((m): m is number => m !== null);
    activities.push({
      id: `L${s.start + 1}`,
      title: s.title.replace(/\s*\((?:[^()]*\d[^()]*)\)\s*$/, '').trim() || s.title,
      location: lineRange(lines, s.start, s.end),
      minutes: ownMinutes ?? (childMinutes.length ? childMinutes.reduce((a, b) => a + b, 0) : null),
      phase: findPhase(`${s.title}\n${headLine}`) ?? inheritedPhase(s.parent),
      text,
      body,
      objectiveIds: refs.ids,
      unknownReferences: refs.unknown,
      via: 'id_reference',
      ...kind,
    });
  }
  return activities;
}

/**
 * A course description has no activities. Each paragraph or list item becomes a passage
 * that can carry references and keyword hits, so the model can see where the
 * description promises an objective (design section 11).
 */
export function extractPassages(
  markdown: string,
  references: ReferenceConfig,
  known: Set<string>,
  rubric: Rubric,
): Activity[] {
  const lines = markdown.split(/\r?\n/);
  const passages: Activity[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const text = lines.slice(start, end).join('\n').trim();
    if (text && !text.startsWith('<!--') && !HEADING.test(text)) {
      const refs = findReferences(text, references, known);
      passages.push({
        id: `P${passages.length + 1}`,
        title: text.split('\n')[0]?.slice(0, 60) ?? '',
        location: lineRange(lines, start, end),
        minutes: null,
        phase: null,
        text,
        body: text,
        objectiveIds: refs.ids,
        unknownReferences: refs.unknown,
        via: 'id_reference',
        ...classify(text, rubric),
      });
    }
    start = -1;
  };
  lines.forEach((line, i) => {
    const blank = line.trim() === '';
    const boundary = blank || HEADING.test(line) || /^\s*[-*+]\s|^\s*\d+\.\s/.test(line);
    if (boundary) flush(i);
    if (!blank && start < 0) start = i;
    if (HEADING.test(line)) flush(i + 1);
  });
  flush(lines.length);
  return passages;
}
