import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { computeCoverage, parseAgenda, parseObjectives } from 'learning-objective-lint';
import type { AlignmentOutput } from '../src/schemas.ts';
import { listLearningObjectives } from '../src/tools/listLearningObjectives.ts';
import { runCheckAlignment, type AlignmentArgs } from '../src/tools/checkAlignment.ts';
import { guarded } from '../src/errors.ts';
import { deps, EXAMPLES, LIB_EXAMPLE, textOf } from './helpers.ts';

/** Through the same guard as the registered tool, so domain errors become results. */
function check(args: Partial<AlignmentArgs> & Pick<AlignmentArgs, 'document'>, d = deps()) {
  return guarded('check_alignment', () =>
    runCheckAlignment(
      { course_id: 'ADB', document_type: 'facilitation_plan', language: 'de', ...args },
      d,
    ),
  );
}

async function ok(args: Parameters<typeof check>[0], d = deps()): Promise<AlignmentOutput> {
  const result = await check(args, d);
  assert.ok(!result.isError, textOf(result));
  return result.structuredContent as AlignmentOutput;
}

const byId = (r: AlignmentOutput) => Object.fromEntries(r.objectives.map((o) => [o.id, o]));

// ------------------------------------------------------------------ the demo document

test('German plan against English objectives: the two demo gaps', async () => {
  const r = await ok({ document: { path: 'adb-facilitation-plan-de.md' } });
  const o = byId(r);
  assert.deepEqual(
    r.objectives.map((x) => [x.id, x.status]),
    [
      ['ADB-1', 'covered'],
      ['ADB-2', 'covered'],
      ['ADB-3', 'partial'],
      ['ADB-4', 'covered'],
      ['ADB-5', 'missing'],
      ['ADB-6', 'covered'],
    ],
  );
  // LO 3 (Apply) is only covered by a lecture.
  assert.deepEqual(
    o['ADB-3']?.findings.map((f) => f.code),
    ['passive_only'],
  );
  assert.deepEqual(o['ADB-3']?.evidence[0]?.types, ['lecture']);
  assert.equal(o['ADB-3']?.needs_judgment.priority, 'high');
  assert.deepEqual(o['ADB-3']?.needs_judgment.criteria.length, 3);
  // LO 5 is never cited, but one passage matches its German keywords.
  assert.equal(o['ADB-5']?.evidence[0]?.via, 'keyword_match');
  assert.equal(o['ADB-5']?.evidence[0]?.confidence, 'low');
  assert.ok(o['ADB-5']?.evidence[0]?.keyword_hits?.includes('Testlauf'));
  // Time share and hygiene.
  assert.deepEqual(o['ADB-2']?.minutes, { total: 15, active: 15, share_percent: 17 });
  assert.equal(r.document.total_minutes, 90);
  assert.equal(r.document.activities, 8); // the break is set aside
  assert.equal(r.hygiene.activities_without_objectives.length, 3);
  assert.equal(r.distribution.audience_check?.includes('(matches)'), true);
});

test('the fixed plan: every objective covered, low priority', async () => {
  const r = await ok({ document: { path: 'adb-facilitation-plan-de-fixed.md' } });
  assert.equal(r.summary.covered, 6);
  assert.equal(r.summary.needs_judgment_high, 0);
  assert.ok(r.objectives.every((o) => o.findings.length === 0));
});

test("the text summary names the verdict as the model's job", async () => {
  const result = await check({ document: { path: 'adb-facilitation-plan-de.md' } });
  assert.match(textOf(result), /verdict \(met \/ weak \/ missed\) is yours/);
  const json = result.content[1];
  assert.ok(json && json.type === 'text' && JSON.parse(json.text).course_id === 'ADB');
});

// ------------------------------------------------------------- other document types

test('mapping document (CSV): rows by reference, unknown reference reported', async () => {
  const r = await ok({
    document: { path: 'adb-mapping.csv' },
    document_type: 'mapping_document',
    format: 'csv',
  });
  const o = byId(r);
  assert.equal(o['ADB-3']?.status, 'partial');
  assert.equal(o['ADB-5']?.status, 'missing');
  assert.equal(o['ADB-6']?.status, 'covered');
  assert.equal(o['ADB-1']?.evidence[0]?.confidence, 'medium');
  assert.deepEqual(r.hygiene.unknown_references, ['LO 9 in Abschlussrunde (row 6)']);
});

test('mapping document (Markdown table): objective column with the objective text', async () => {
  const text = [
    '| Learning Objective | Activity | Min |',
    '|---|---|---|',
    '| Apply a five-point checklist to an agent-generated change before merging it. | Pair exercise on a real change | 10 |',
    '| Something nobody wrote | Lecture | 5 |',
  ].join('\n');
  const r = await ok({ document: { text }, document_type: 'mapping_document', language: 'en' });
  assert.equal(byId(r)['ADB-3']?.status, 'covered');
  assert.equal(r.hygiene.unmatched_rows.length, 1);
});

test('course description: promises are at best unclear, never covered', async () => {
  const r = await ok({
    document: { path: 'adb-course-description-de.md' },
    document_type: 'course_description',
  });
  assert.equal(r.summary.covered, 0);
  assert.equal(r.summary.partial, 0);
  assert.equal(byId(r)['ADB-6']?.status, 'unclear');
  assert.equal(r.document.activities, 0);
});

test('an English plan with an unrecognised activity type is unclear, not missing', async () => {
  const text = '### 1 Checklist session (10 min)\nLO 3: participants and the checklist.\n';
  const r = await ok({ document: { text }, language: 'en', objective_ids: ['ADB-3'] });
  assert.equal(r.objectives.length, 1);
  assert.equal(r.objectives[0]?.status, 'unclear');
  assert.deepEqual(r.hygiene.unclassified_activities, ['1 Checklist session (lines 1-2)']);
});

// ------------------------------------------------- same answer as the existing checker

test('agenda_yaml: same statuses as learning-objective-lint coverage on its own example', async () => {
  const d = deps({ courseDirs: [LIB_EXAMPLE], docRoots: [LIB_EXAMPLE] });
  const course = listLearningObjectives({}, d).structuredContent as {
    courses: Array<{ id: string }>;
  };
  const courseId = course.courses[0]?.id ?? '';
  const r = await ok(
    {
      course_id: courseId,
      document: { path: 'agenda.yaml' },
      format: 'agenda_yaml',
      language: 'en',
    },
    d,
  );

  const objectives = parseObjectives(
    yaml.load(readFileSync(join(LIB_EXAMPLE, 'objectives.yaml'), 'utf8')),
  );
  const agenda = parseAgenda(yaml.load(readFileSync(join(LIB_EXAMPLE, 'agenda.yaml'), 'utf8')));
  const expected = computeCoverage(objectives, agenda);
  assert.deepEqual(
    r.objectives.map((o) => [o.id, o.status, o.over_covered]),
    expected.rows.map((row) => [row.lo.id, row.status, row.overCovered]),
  );
  assert.equal(r.hygiene.unknown_references.length, expected.unknownRefs.length);
});

// ---------------------------------------------------------------------- domain errors

const errorCode = (result: Awaited<ReturnType<typeof check>>) => {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  return textOf(result).split(':')[0];
};

test('domain errors come back as isError with a code and a hint', async () => {
  assert.equal(errorCode(await check({ document: { text: '  \n' } })), 'empty_document');
  assert.equal(
    errorCode(await check({ course_id: 'NOPE', document: { text: 'x' } })),
    'unknown_course',
  );
  assert.match(
    textOf(await check({ course_id: 'NOPE', document: { text: 'x' } })),
    /Hint: Available course ids: ADB/,
  );
  assert.equal(
    errorCode(
      await check({ document: { text: 'x' }, document_type: 'course_description', format: 'csv' }),
    ),
    'unsupported_combination',
  );
  assert.equal(
    errorCode(await check({ document: { text: 'Nur Fließtext ohne Blöcke.' } })),
    'no_activities_found',
  );
  assert.equal(
    errorCode(
      await check({ document: { text: '### a (5 Min.)\nLO 1' }, objective_ids: ['ADB-9'] }),
    ),
    'unknown_objective_ids',
  );
  assert.equal(
    errorCode(
      await check({
        document: { text: 'x' },
        document_type: 'mapping_document',
        format: 'markdown',
      }),
    ),
    'no_activities_found',
  );
});

test('paths: only under the allowed folders, only known file types', async () => {
  assert.equal(
    errorCode(await check({ document: { path: '../package.json' } })),
    'path_not_allowed',
  );
  assert.equal(errorCode(await check({ document: { path: '/etc/hosts' } })), 'path_not_allowed');
  assert.equal(errorCode(await check({ document: { path: 'missing.md' } })), 'file_not_found');
  const noRoots = deps({ docRoots: [join(EXAMPLES, 'does-not-exist')] });
  assert.equal(
    errorCode(await check({ document: { path: 'adb-mapping.csv' } }, noRoots)),
    'path_not_allowed',
  );
});

test('list_learning_objectives: courses, objectives, module filter and lint', async () => {
  const d = deps();
  const list = listLearningObjectives({}, d).structuredContent as {
    courses: Array<{ id: string; objectives: number }>;
  };
  assert.deepEqual(list.courses, [
    { id: 'ADB', title: 'Agentic Development Basics (fictional)', version: '0.1', objectives: 6 },
  ]);
  const m2 = listLearningObjectives({ course_id: 'ADB', module_id: 'M2', include_lint: true }, d)
    .structuredContent as {
    objectives: Array<{ id: string }>;
    lint: Array<{ worst_status: string }>;
  };
  assert.deepEqual(
    m2.objectives.map((o) => o.id),
    ['ADB-3', 'ADB-4', 'ADB-5'],
  );
  assert.ok(m2.lint.every((l) => l.worst_status === 'pass'));
  const bad = await guarded('list', () =>
    listLearningObjectives({ course_id: 'ADB', module_id: 'M9' }, d),
  );
  assert.match(textOf(bad), /^unknown_module/);
});
