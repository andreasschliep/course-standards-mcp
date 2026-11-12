import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_REFERENCES } from '../src/data/catalogs.ts';
import { classify } from '../src/extract/activities.ts';
import { extractPassages, extractPlan, findMinutes } from '../src/extract/markdown.ts';
import { findReferences, resolveCell } from '../src/extract/references.ts';
import { parseCsv, parseMarkdownTables } from '../src/extract/table.ts';
import { rubric } from './helpers.ts';

const ADB_REFS = { prefixes: ['LO', 'Lernziel', 'Lernziele'], idTemplate: 'ADB-{n}' };
const ADB_IDS = new Set(['ADB-1', 'ADB-2', 'ADB-3', 'ADB-4', 'ADB-5', 'ADB-6']);
const DOTTED = new Set(['1.4', '2.1', '3.1', '3.2', '3.3', '3.4', '3.5', '6.4']);

// ------------------------------------------------------------------------ references

test('references: prefix with a list, a dotted list and catalog ids written out', () => {
  assert.deepEqual(findReferences('**Lernziele:** LO 2, 3 und 6', ADB_REFS, ADB_IDS).ids, [
    'ADB-2',
    'ADB-3',
    'ADB-6',
  ]);
  assert.deepEqual(findReferences('LO 1.4, 2.1, 6.4', DEFAULT_REFERENCES, DOTTED).ids, [
    '1.4',
    '2.1',
    '6.4',
  ]);
  assert.deepEqual(findReferences('siehe ADB-4 und ADB-5', ADB_REFS, ADB_IDS).ids, [
    'ADB-4',
    'ADB-5',
  ]);
});

test('references: ranges with en dash or hyphen expand only when every id exists', () => {
  assert.deepEqual(findReferences('LO 3.1–3.5', DEFAULT_REFERENCES, DOTTED).ids, [
    '3.1',
    '3.2',
    '3.3',
    '3.4',
    '3.5',
  ]);
  assert.deepEqual(findReferences('Lernziele LO 1-6 einführen', ADB_REFS, ADB_IDS).ids, [
    ...ADB_IDS,
  ]);
  const partial = findReferences('LO 3.1–3.9', DEFAULT_REFERENCES, DOTTED);
  assert.deepEqual(partial.ids, []);
  assert.deepEqual(partial.unknown, ['LO 3.1–3.9']);
});

test('references: unknown numbers are reported, numbers without a prefix are ignored', () => {
  const r = findReferences('LO 9, Beginn 09:00–10:30, Seite 1-6', ADB_REFS, ADB_IDS);
  assert.deepEqual(r.ids, []);
  assert.deepEqual(r.unknown, ['LO 9']);
  assert.deepEqual(findReferences('Kursdauer 90 Minuten, 18 LOs', ADB_REFS, ADB_IDS), {
    ids: [],
    unknown: [],
  });
});

test('references: a note in brackets does not end the list', () => {
  const r = findReferences(
    'LO 3.1–3.3 [siehe Hinweis 3], 6.4 (optional), 1.4',
    DEFAULT_REFERENCES,
    DOTTED,
  );
  assert.deepEqual(r.ids, ['3.1', '3.2', '3.3', '6.4', '1.4']);
  assert.deepEqual(r.unknown, [], 'the 3 inside the note is not a reference');
});

test('references: a table cell may hold a bare list', () => {
  assert.deepEqual(resolveCell('2, 3', ADB_REFS, ADB_IDS).ids, ['ADB-2', 'ADB-3']);
  assert.deepEqual(resolveCell('Lernziel 5', ADB_REFS, ADB_IDS).ids, ['ADB-5']);
  assert.deepEqual(resolveCell('Abschluss', ADB_REFS, ADB_IDS), { ids: [], unknown: [] });
});

// --------------------------------------------------------------------------- minutes

test('minutes: explicit forms win over a time range', () => {
  assert.equal(findMinutes('### 2.3 Agenten-Output prüfen (10 Min.)'), 10);
  assert.equal(findMinutes('Block 1.1: Willkommen (45 min)'), 45);
  assert.equal(findMinutes('**09:00–09:30 | 30 Minuten | C1**'), 30);
  assert.equal(findMinutes('Pause (09:55–10:10)'), 15);
  assert.equal(findMinutes('Ein Mindset von 5 Mindsets'), null);
});

// --------------------------------------------------------------------- activity types

test('activity types: compounds, ASCII umlauts, phrases and breaks', () => {
  const r = rubric();
  assert.equal(classify('Partnerübung mit Checkliste', r).ceiling, 'Apply');
  assert.equal(classify('Uebung in Paaren', r).ceiling, 'Apply');
  assert.equal(classify('A short case study in groups', r).ceiling, 'Analyse');
  assert.equal(classify('Vortrag und Live-Demo', r).ceiling, 'Understand');
  assert.equal(classify('Vortrag und Live-Demo', r).passive, true);
  assert.equal(classify('Kaffeepause', r).isBreak, true);
  assert.equal(classify('Reflexion in Paaren', r).ceiling, null);
  assert.equal(classify('Ein Agent liefert Code', r).types.length, 0);
});

// --------------------------------------------------------------------------- Markdown

test('plan: a section that cites objectives is one activity, including its sub-sections', () => {
  const plan = [
    '# Kurs (90 Minuten)',
    '## Tag 1',
    '### 2.3 Teamentwicklung',
    '**09:00–10:40 | 100 Min. | C3 Concrete Practice | LO 3.1–3.5**',
    '#### Phase 1: Input (10 Min.)',
    'Kurzinput.',
    '#### Phase 2: Workshop (90 Min.)',
    'Rollenspiel in Gruppen.',
    '### Puffer (16:30–16:45)',
    '### 2.4 Abschluss (5 Min.)',
    'LO 6.4: Blitzlicht.',
  ].join('\n');
  const activities = extractPlan(plan, DEFAULT_REFERENCES, DOTTED, rubric());
  assert.deepEqual(
    activities.map((a) => [
      a.title,
      a.minutes,
      a.phase,
      a.objectiveIds.length,
      a.ceiling,
      a.isBreak,
    ]),
    [
      ['2.3 Teamentwicklung', 100, 'C3', 5, 'Apply', false],
      ['Puffer', 15, null, 0, null, true],
      ['2.4 Abschluss', 5, null, 1, 'Understand', false],
    ],
  );
  assert.equal(activities[0]?.location, 'lines 3-8');
});

test('plan: headings inside code fences are ignored', () => {
  const plan = '### 1.1 Block (5 Min.)\nLO 1\n```\n### not a heading (9 Min.)\n```\n';
  const activities = extractPlan(plan, ADB_REFS, ADB_IDS, rubric());
  assert.equal(activities.length, 1);
});

test('course description: paragraphs and list items become passages', () => {
  const text = '# Titel\n\nErster Absatz,\nzwei Zeilen.\n\n- Punkt eins\n- Punkt zwei\n';
  const passages = extractPassages(text, ADB_REFS, ADB_IDS, rubric());
  assert.deepEqual(
    passages.map((p) => p.location),
    ['lines 3-4', 'line 6', 'line 7'],
  );
});

// ------------------------------------------------------------------------------ tables

test('CSV: semicolons, quotes with delimiters and escaped quotes, CRLF', () => {
  const rows = parseCsv(
    'LO;Aktivität;Minuten\r\n1;"Übung; in Paaren";15\r\n2;"Sie sagt ""Hallo""";5\r\n',
  );
  assert.deepEqual(rows, [
    ['LO', 'Aktivität', 'Minuten'],
    ['1', 'Übung; in Paaren', '15'],
    ['2', 'Sie sagt "Hallo"', '5'],
  ]);
});

test('Markdown tables: separator rows are skipped, each table keeps its first line', () => {
  const tables = parseMarkdownTables(
    'Text\n\n| LO | Aktivität |\n|---|---|\n| 1 | Übung |\n\nmehr\n| a | b |\n',
  );
  assert.deepEqual(tables, [
    {
      line: 3,
      rows: [
        ['LO', 'Aktivität'],
        ['1', 'Übung'],
      ],
    },
    { line: 8, rows: [['a', 'b']] },
  ]);
});
