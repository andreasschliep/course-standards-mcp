import assert from 'node:assert/strict';
import test from 'node:test';
import { parseObjectives } from 'learning-objective-lint';
import { checkAlignment } from '../src/alignment.ts';
import type { Catalog } from '../src/data/catalogs.ts';
import { loadTermbase, type Termbase } from '../src/data/termbase.ts';
import { guarded } from '../src/errors.ts';
import { validationPrompt } from '../src/prompts.ts';
import type { TermsOutput } from '../src/schemas.ts';
import { checkTerms, germanFormsIn, lookupTerm } from '../src/terms.ts';
import { runCheckTerms } from '../src/tools/terms.ts';
import { deps, rubric, textOf } from './helpers.ts';

const termbase = (): Termbase => loadTermbase(deps().config.termbaseFile);
const found = (text: string, language: 'en' | 'de' | 'de-CH' = 'de') =>
  checkTerms(text, language, termbase()).map((f) => [f.category, f.found, f.suggestion]);

// ------------------------------------------------------------------------- check_terms

test('the demo plan: a deprecated term and a translated role name', async () => {
  const result = await guarded('check_terms', () =>
    runCheckTerms({ document: { path: 'adb-facilitation-plan-de.md' }, language: 'de' }, deps()),
  );
  const data = result.structuredContent as TermsOutput;
  assert.deepEqual(
    data.findings.map((f) => [f.category, f.found, f.suggestion, f.line]),
    [
      ['deprecated', 'Development Team', 'Developer:innen', 40],
      ['keep_english', 'Produktverantwortliche', 'Product Owner:in', 64],
    ],
  );
  assert.equal(data.findings[0]?.source, 'sg2020-de');
});

test('the fixed plan has no term findings', async () => {
  const result = await guarded('check_terms', () =>
    runCheckTerms(
      { document: { path: 'adb-facilitation-plan-de-fixed.md' }, language: 'de' },
      deps(),
    ),
  );
  assert.equal((result.structuredContent as TermsOutput).summary.findings, 0);
});

test('de-CH: every ß is an error with the ss spelling as suggestion', () => {
  assert.deepEqual(found('Grün heißt nicht fertig, sagt die Straße.', 'de-CH'), [
    ['locale', 'heißt', 'heisst'],
    ['locale', 'Straße', 'Strasse'],
  ]);
  assert.deepEqual(found('Grün heißt nicht fertig.', 'de'), []);
});

test('official forms and the female and male versions pass; translated core terms do not', () => {
  assert.deepEqual(found('Die Product Ownerin und die Developer pflegen das Product Backlog.'), []);
  assert.deepEqual(found('Das Inkrement entsteht in der Sprint Retrospektive.'), [
    ['keep_english', 'Inkrement', 'Increment'],
    ['keep_english', 'Sprint Retrospektive', 'Sprint Retrospective'],
  ]);
  assert.deepEqual(found('Das Team arbeitet selbstorganisiert und funktionsübergreifend.'), [
    ['deprecated', 'selbstorganisiert', 'selbstmanagend'],
    ['wrong_translation', 'funktionsübergreifend', 'interdisziplinär'],
  ]);
});

test('English texts: deprecated and unofficial terms, but no German rules', () => {
  assert.deepEqual(found('The Development Team holds a Daily Standup.', 'en'), [
    ['deprecated', 'Development Team', 'Developers'],
    ['wrong_translation', 'Daily Standup', 'Daily Scrum'],
  ]);
  assert.deepEqual(found('The Developers own the Sprint Backlog.', 'en'), []);
});

test('longest form first, inflection endings, code spans and URLs skipped', () => {
  assert.deepEqual(found('Backlog Grooming und die Development Teams'), [
    ['deprecated', 'Backlog Grooming', 'das Refinement des Product Backlogs'],
    ['deprecated', 'Development Teams', 'Developer:innen'],
  ]);
  assert.deepEqual(found('Siehe `Development Team` und https://example.org/Development-Team'), []);
});

test('allow_in phrases are not flagged', () => {
  const tb = termbase();
  const custom: Termbase = {
    ...tb,
    terms: tb.terms.map((t) =>
      t.id === 'developers'
        ? { ...t, allow_in: ['Development Team Lead (fictional job title)'] }
        : t,
    ),
  };
  const findings = checkTerms(
    'Die Development Team Lead (fictional job title) sagt hallo.',
    'de',
    custom,
  );
  assert.deepEqual(findings, []);
});

test('an empty document is a domain error', async () => {
  const result = await guarded('check_terms', () =>
    runCheckTerms({ document: { text: '' }, language: 'de' }, deps()),
  );
  assert.equal(result.isError, true);
  assert.match(textOf(result), /^empty_document/);
});

// ------------------------------------------------------------------------- lookup_term

test('lookup_term: by English term, German form, variant, wrong form; suggestions', () => {
  const tb = termbase();
  assert.equal(lookupTerm('sprint goal', tb).entries[0]?.de, 'Sprint-Ziel');
  assert.equal(lookupTerm('Product Ownerin', tb).entries[0]?.matched_as, 'variant');
  assert.equal(lookupTerm('Inkrement', tb).entries[0]?.matched_as, 'wrong');
  assert.equal(lookupTerm('Development Team', tb).entries[0]?.matched_as, 'deprecated');
  const none = lookupTerm('Retro', tb);
  assert.equal(none.found, false);
  assert.ok(none.suggestions.includes('Sprint Retrospective'));
});

test('every term cites a known source', () => {
  const tb = termbase();
  assert.ok(tb.terms.length >= 30);
  for (const t of tb.terms) assert.ok(tb.sources[t.source], t.id);
});

// ------------------------------------------- term base in check_alignment (design 5.4)

test('German forms from the term base find candidates for an English objective', () => {
  // One group per term; "Sprint" alone is dropped because it is part of "Sprint Goal".
  assert.deepEqual(
    germanFormsIn('Craft a Sprint Goal with the Product Owner', termbase()).map((g) => g[0]),
    ['Product Owner:in', 'Sprint-Ziel'],
  );
  const doc = parseObjectives({
    metadata: { id: 'X' },
    modules: [
      {
        id: 'M',
        objectives: [
          { id: 'X-1', level: 'Apply', text: 'Craft a Sprint Goal with the Product Owner.' },
        ],
      },
    ],
  });
  const catalog: Catalog = {
    id: 'X',
    title: 'X (fictional)',
    version: '1',
    audienceLevel: null,
    file: 'x.yaml',
    references: { prefixes: ['LO'], idTemplate: 'X-{n}' },
    objectives: doc.objectives.map((o) => ({ ...o, keywords: { de: [], en: [] } })),
    doc,
  };
  const plan =
    '### 1 Planung (20 Min.)\nÜbung: Die Gruppe formuliert ein Sprint-Ziel mit der Product Owner:in.\n';
  const result = checkAlignment({
    catalog,
    rubric: rubric(),
    termbase: termbase(),
    text: plan,
    source: 'text',
    documentType: 'facilitation_plan',
    format: 'markdown',
    language: 'de',
    maxEvidence: 3,
  });
  const objective = result.objectives[0];
  assert.equal(objective?.status, 'missing');
  assert.equal(objective?.evidence[0]?.via, 'keyword_match');
  assert.deepEqual(objective?.evidence[0]?.keyword_hits, ['Product Owner:in', 'Sprint-Ziel']);
});

// --------------------------------------------------------------------- prompt template

test('validation prompt: path or text, report language, the never-met-without-location rule', () => {
  const byPath = validationPrompt({
    course_id: 'ADB',
    document: 'adb-mapping.csv',
    document_type: 'mapping_document',
    language: 'de',
  });
  assert.match(byPath, /document \{ "path": "adb-mapping.csv" \}/);
  assert.match(byPath, /format: "csv"/);
  assert.match(byPath, /Lernziel · Status \(erfüllt \/ schwach \/ verfehlt\)/);
  assert.match(byPath, /never call an objective met without a location/);
  assert.doesNotMatch(byPath, /^Document:/m);

  const byText = validationPrompt({
    course_id: 'ADB',
    document: '### 1 Block (5 Min.)\nLO 1',
    document_type: 'facilitation_plan',
    language: 'en',
  });
  assert.match(byText, /document \{ "text": <the document text below> \}/);
  assert.match(byText, /Objective · Status \(met \/ weak \/ missed\)/);
  assert.match(byText, /Document:\n\n### 1 Block/);
});
