/**
 * check_alignment: from a document to evidence per learning objective.
 *
 *   document ──extract──> activities (blocks, rows or passages; refs, minutes, types)
 *            ──library──> computeCoverage (covered / partial / missing, over-covered,
 *                         activities without objectives, Bloom distribution)
 *            ──server──>  unclear, keyword candidates, findings, needs_judgment
 *
 * The server never decides "met": it reports evidence and asks the question the model
 * has to answer with the rubric (design section 4).
 */
import yaml from 'js-yaml';
import {
  computeCoverage,
  InputError,
  levelIndex,
  lintObjective,
  loadVerbs,
  parseAgenda,
  type AgendaDoc,
  type BloomLevel,
} from 'learning-objective-lint';
import { LIMITS } from './config.ts';
import type { Catalog, CatalogObjective } from './data/catalogs.ts';
import type { Rubric } from './data/rubric.ts';
import { DomainError } from './errors.ts';
import { classify, type Activity } from './extract/activities.ts';
import { extractPassages, extractPlan } from './extract/markdown.ts';
import { parseCsv, parseMarkdownTables, rowsToActivities } from './extract/table.ts';
import type { AlignmentOutput, EvidenceStatus } from './schemas.ts';
import { cueMatches, excerpt, makeCue, tokens, type CueLanguage } from './text.ts';

export type DocumentType = 'facilitation_plan' | 'mapping_document' | 'course_description';
export type Format = 'markdown' | 'csv' | 'agenda_yaml';
export type Language = 'en' | 'de' | 'de-CH';

export interface AlignmentRequest {
  catalog: Catalog;
  rubric: Rubric;
  text: string;
  source: string;
  documentType: DocumentType;
  format: Format;
  language: Language;
  objectiveIds?: string[] | undefined;
  maxEvidence: number;
}

type Objective = AlignmentOutput['objectives'][number];
type Evidence = Objective['evidence'][number];

const ALLOWED: Record<DocumentType, Format[]> = {
  facilitation_plan: ['markdown', 'agenda_yaml'],
  mapping_document: ['markdown', 'csv'],
  course_description: ['markdown'],
};

// ------------------------------------------------------------------------- extraction

interface Extracted {
  activities: Activity[];
  unmatchedRows: string[];
  /** agenda_yaml only: the level the designer claims per activity and objective. */
  claimed?: Map<string, Map<string, BloomLevel>>;
}

function fromAgendaYaml(text: string, rubric: Rubric): Extracted {
  let agenda: AgendaDoc;
  try {
    agenda = parseAgenda(yaml.load(text), 'agenda');
  } catch (error) {
    const message =
      error instanceof InputError || error instanceof Error ? error.message : String(error);
    throw new DomainError(
      'invalid_document',
      `The agenda YAML is invalid: ${message}`,
      'Use the learning-objective-lint agenda format (activities with id, title, minutes, description, objectives of {id, level}), or pass the plan as Markdown.',
    );
  }
  const claimed = new Map<string, Map<string, BloomLevel>>();
  const activities = agenda.activities.map((a): Activity => {
    const levels = new Map(a.objectives.map((o) => [o.id, o.level]));
    claimed.set(a.id, levels);
    const text = `${a.title}\n${a.description}`;
    const kind = classify(text, rubric);
    let ceiling: BloomLevel | null = null;
    for (const level of levels.values())
      if (ceiling === null || levelIndex(level) > levelIndex(ceiling)) ceiling = level;
    return {
      id: a.id,
      title: a.title || a.id,
      location: `activity ${a.id}`,
      minutes: a.minutes,
      phase: null,
      text,
      body: a.description,
      objectiveIds: a.objectives.map((o) => o.id),
      unknownReferences: [],
      via: 'agenda',
      ...kind,
      ceiling,
      isBreak: false,
    };
  });
  return { activities, unmatchedRows: [], claimed };
}

function extract(req: AlignmentRequest): Extracted {
  const { catalog, rubric, text, documentType, format } = req;
  const known = new Set(catalog.objectives.map((o) => o.id));
  if (format === 'agenda_yaml') return fromAgendaYaml(text, rubric);
  if (documentType === 'course_description') {
    return {
      activities: extractPassages(text, catalog.references, known, rubric),
      unmatchedRows: [],
    };
  }
  if (documentType === 'facilitation_plan') {
    return { activities: extractPlan(text, catalog.references, known, rubric), unmatchedRows: [] };
  }
  if (format === 'csv') {
    return rowsToActivities(parseCsv(text), null, catalog.references, catalog.objectives, rubric);
  }
  const tables = parseMarkdownTables(text);
  if (tables.length === 0) return { activities: [], unmatchedRows: [] };
  let lastError: unknown;
  for (const table of tables) {
    try {
      return rowsToActivities(
        table.rows,
        table.line,
        catalog.references,
        catalog.objectives,
        rubric,
      );
    } catch (error) {
      lastError = error; // try the next table
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------- keyword search

const STOPWORDS = new Set(
  'a an and are as at be by for from in into is it its of on or that the their them this to using with without whether when which who one each two three five four before after so may must can its'.split(
    ' ',
  ),
);

let verbWords: Set<string> | null = null;
function bloomVerbWords(): Set<string> {
  if (!verbWords) {
    const v = loadVerbs();
    verbWords = new Set([
      ...Object.values(v.byLevel).flat(),
      ...v.vague,
      ...v.aspirational,
      ...v.activity,
    ]);
  }
  return verbWords;
}

/** Keywords for candidate passages: from the catalog, else the content words of the objective. */
function keywordsFor(
  lo: CatalogObjective,
  language: Language,
): { words: string[]; language: CueLanguage } {
  const lang: CueLanguage = language === 'en' ? 'en' : 'de';
  const own = lo.keywords[lang];
  if (own.length) return { words: own, language: lang };
  const content = tokens(lo.text).filter(
    (t) => t.length >= 4 && !STOPWORDS.has(t) && !bloomVerbWords().has(t),
  );
  return { words: [...new Set(content)], language: 'en' };
}

function keywordHits(
  activity: Activity,
  keywords: { words: string[]; language: CueLanguage },
): string[] {
  const toks = tokens(activity.text);
  return keywords.words.filter((w) => cueMatches(makeCue(w, keywords.language), toks));
}

// ------------------------------------------------------------------------- assessment

const LIMITS_BY_TYPE: Record<DocumentType, string[]> = {
  facilitation_plan: [
    'Activity types are inferred from cue words, not from what participants actually do.',
    'Minutes of a block that serves several objectives count fully for each of them (upper bound).',
    'Passages that cover an objective without citing it are only candidates (keyword match).',
  ],
  mapping_document: [
    'Activity types are inferred from cue words in the row description.',
    'Rows are matched to objectives by reference or exact objective text only.',
  ],
  course_description: [
    'A course description has no activities: every objective is at best "unclear".',
    'Passages are matched by reference or keywords; a match shows a promise, not coverage.',
  ],
};

function confidenceOf(activity: Activity): Evidence['confidence'] {
  if (activity.via === 'keyword_match') return 'low';
  if (activity.ceiling === null) return 'medium';
  if (activity.via === 'table_row') return 'medium';
  return 'high';
}

function toEvidence(
  activity: Activity,
  via: Evidence['via'],
  ceiling: BloomLevel | null,
  extra?: string[],
): Evidence {
  return {
    activity: activity.title,
    location: activity.location,
    via,
    types: activity.types,
    ceiling,
    minutes: activity.minutes,
    confidence: via === 'keyword_match' ? 'low' : confidenceOf(activity),
    excerpt: excerpt(activity.body || activity.title, LIMITS.excerptChars),
    ...(extra ? { keyword_hits: extra } : {}),
  };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

const sum = (values: Array<number | null>) => {
  const numbers = values.filter((v): v is number => v !== null);
  return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
};

export function checkAlignment(req: AlignmentRequest): AlignmentOutput {
  const { catalog, rubric, documentType, format, maxEvidence } = req;

  if (!ALLOWED[documentType].includes(format)) {
    throw new DomainError(
      'unsupported_combination',
      `A ${documentType} cannot be read as ${format}.`,
      `Allowed formats for ${documentType}: ${ALLOWED[documentType].join(', ')}.`,
    );
  }
  const objectiveIds = req.objectiveIds?.length ? req.objectiveIds : undefined;
  const unknownIds = (objectiveIds ?? []).filter(
    (id) => !catalog.objectives.some((o) => o.id === id),
  );
  if (unknownIds.length) {
    throw new DomainError(
      'unknown_objective_ids',
      `Course ${catalog.id} has no objective ${unknownIds.join(', ')}.`,
      `Call list_learning_objectives for course ${catalog.id} to see its objective ids.`,
    );
  }

  const { activities, unmatchedRows, claimed } = extract(req);
  if (activities.length > LIMITS.maxActivities) {
    throw new DomainError(
      'document_too_large',
      `The document yields ${activities.length} activities (limit ${LIMITS.maxActivities}).`,
      'Check the document in parts.',
    );
  }
  const real = activities.filter((a) => !a.isBreak);
  if (documentType !== 'course_description' && real.length === 0) {
    throw new DomainError(
      'no_activities_found',
      documentType === 'facilitation_plan'
        ? 'No blocks with a time or an objective reference were found.'
        : 'No table with an objective column was found.',
      documentType === 'facilitation_plan'
        ? 'Give each block a heading with its minutes, e.g. "### 2.3 Title (15 Min.)", and cite objectives as "LO 3". Is this a course description? Then use document_type: course_description.'
        : 'Pass a Markdown table or CSV with a column "LO" or "Lernziel". Is this a course description? Then use document_type: course_description.',
    );
  }

  // Library coverage: typed activities only. Passages of a course description are not
  // activities, and untyped blocks have no level to pass on.
  const byId = new Map(activities.map((a) => [a.id, a]));
  const agendaActivities =
    documentType === 'course_description'
      ? []
      : real
          .map((a) => ({
            id: a.id,
            title: a.title,
            minutes: a.minutes,
            description: a.body,
            objectives:
              a.ceiling === null
                ? []
                : a.objectiveIds.map((id) => ({
                    id,
                    level: claimed?.get(a.id)?.get(id) ?? (a.ceiling as BloomLevel),
                  })),
          }))
          // An untyped block that cites objectives is not "without objectives".
          .filter((a, i) => a.objectives.length > 0 || (real[i]?.objectiveIds.length ?? 0) === 0);
  const coverage = computeCoverage(catalog.doc, { metadata: {}, activities: agendaActivities });

  const documentMinutes = sum(activities.map((a) => a.minutes));
  const rows = coverage.rows.filter((r) => !objectiveIds || objectiveIds.includes(r.lo.id));

  const objectives: Objective[] = rows.map((row) => {
    const lo = catalog.objectives.find((o) => o.id === row.lo.id) as CatalogObjective;
    const typedLinks = row.links
      .map((l) => ({ activity: byId.get(l.activityId) as Activity, level: l.level }))
      .sort((a, b) => levelIndex(b.level) - levelIndex(a.level));
    const citing = real.filter((a) => a.objectiveIds.includes(lo.id));
    const untyped = citing.filter((a) => a.ceiling === null);

    // Status: the library's, plus "unclear" where it cannot know.
    let status: EvidenceStatus = row.status;
    let candidates: Array<{ activity: Activity; hits: string[] }> = [];
    if (documentType === 'course_description' || row.status === 'missing') {
      const keywords = keywordsFor(lo, req.language);
      const need = Math.min(2, keywords.words.length);
      candidates = real
        .filter((a) => !a.objectiveIds.includes(lo.id))
        .map((activity) => ({ activity, hits: keywordHits(activity, keywords) }))
        .filter((c) => need > 0 && c.hits.length >= need)
        .sort((a, b) => b.hits.length - a.hits.length);
    }
    if (documentType === 'course_description')
      status = citing.length || candidates.length ? 'unclear' : 'missing';
    else if (row.status === 'missing' && untyped.length) status = 'unclear';

    const evidence: Evidence[] = [
      ...typedLinks.map((l) => toEvidence(l.activity, l.activity.via, l.level)),
      ...untyped.map((a) => toEvidence(a, a.via, null)),
      ...(documentType === 'course_description'
        ? citing.map((a) => toEvidence(a, a.via, a.ceiling))
        : []),
      ...candidates.map((c) => toEvidence(c.activity, 'keyword_match', c.activity.ceiling, c.hits)),
    ].slice(0, maxEvidence);

    const linked = [...new Set([...typedLinks.map((l) => l.activity), ...untyped])];
    const total = sum(linked.map((a) => a.minutes));
    const active = sum(
      linked.map((a) =>
        a.ceiling !== null && levelIndex(a.ceiling) >= levelIndex('Apply') ? a.minutes : 0,
      ),
    );

    const findings: Objective['findings'] = [];
    const target = lo.level;
    if (
      status === 'partial' &&
      target &&
      levelIndex(target) >= levelIndex('Apply') &&
      untyped.length === 0 &&
      typedLinks.every((l) => l.activity.passive)
    ) {
      findings.push({
        code: 'passive_only',
        severity: 'warn',
        message: `Target is ${target}, but the only evidence is ${[...new Set(typedLinks.flatMap((l) => l.activity.types))].join(', ')}: participants receive, they do not perform.`,
      });
    }
    const lint = lintObjective({ id: lo.id, level: lo.level, text: lo.text });
    if (lint.worstStatus === 'fail') {
      const rules = lint.results.filter((r) => r.status === 'fail').map((r) => r.ruleId);
      findings.push({
        code: 'objective_wording',
        severity: 'info',
        message: `The objective's own wording fails the lint (${rules.join(', ')}), which makes any judgment harder.`,
      });
    }
    if (
      documentType === 'facilitation_plan' &&
      linked.length &&
      linked.every((a) => a.minutes === null)
    ) {
      findings.push({
        code: 'no_time',
        severity: 'info',
        message: 'No evidence block states its minutes.',
      });
    }

    // The question the model has to answer, and the rubric criteria for the target level.
    const questions = rubric.data.questions;
    const named = (list: Activity[]) =>
      list.map((a) => `"${a.title}" (${a.location})`).join(', ') || 'none';
    let template: string;
    let shown: Activity[];
    if (status === 'covered')
      [template, shown] = [questions.covered, typedLinks.map((l) => l.activity)];
    else if (status === 'partial')
      [template, shown] = [questions.partial, typedLinks.map((l) => l.activity)];
    else if (status === 'unclear')
      [template, shown] = [questions.unclear, untyped.length ? untyped : citing];
    else if (candidates.length)
      [template, shown] = [questions.missing_with_candidates, candidates.map((c) => c.activity)];
    else [template, shown] = [questions.missing, []];
    if (documentType === 'course_description' && status === 'unclear') {
      [template, shown] = [
        questions.missing_with_candidates,
        [...citing, ...candidates.map((c) => c.activity)],
      ];
    }
    const lowPriority = status === 'covered' && evidence[0]?.confidence === 'high';

    return {
      id: lo.id,
      level: lo.level,
      text: lo.text,
      status,
      over_covered: row.overCovered,
      evidence,
      minutes: {
        total,
        active: total === null ? null : active,
        share_percent:
          total !== null && documentMinutes ? Math.round((total / documentMinutes) * 100) : null,
      },
      findings,
      needs_judgment: {
        priority: lowPriority ? 'low' : 'high',
        question: fill(template, {
          id: lo.id,
          level: lo.level ?? 'its target level',
          text: lo.text,
          activities: named(shown.slice(0, maxEvidence)),
        }),
        criteria: lo.level ? rubric.criteriaFor(lo.level) : [],
        rubric: 'rubric://bloom',
      },
    };
  });

  const count = (s: EvidenceStatus) => objectives.filter((o) => o.status === s).length;
  const pc = coverage.distribution.profileCheck;
  const audienceCheck = !pc
    ? null
    : !pc.known
      ? `Unknown audience level "${pc.audience}".`
      : `Audience ${pc.audience}: ${Math.round((pc.share ?? 0) * 100)} % of objectives target ${pc.focus?.join('/')}; expected at least ${Math.round((pc.minShare ?? 0) * 100)} % (${pc.ok ? 'matches' : 'does not match'}).`;

  const named = (a: Activity) => `${a.title} (${a.location})`;
  return {
    course_id: catalog.id,
    document: {
      type: documentType,
      format,
      language: req.language,
      source: req.source,
      activities: documentType === 'course_description' ? 0 : real.length,
      total_minutes: documentMinutes,
    },
    summary: {
      objectives: objectives.length,
      covered: count('covered'),
      partial: count('partial'),
      unclear: count('unclear'),
      missing: count('missing'),
      over_covered: objectives.filter((o) => o.over_covered).length,
      needs_judgment_high: objectives.filter((o) => o.needs_judgment.priority === 'high').length,
    },
    objectives,
    hygiene: {
      unknown_references: [
        ...activities.flatMap((a) => a.unknownReferences.map((u) => `${u} in ${named(a)}`)),
        // agenda_yaml: ids the agenda cites that the catalog does not have (library check)
        ...coverage.unknownRefs.map(
          (u) => `${u.objectiveId} in ${named(byId.get(u.activityId) as Activity)}`,
        ),
      ],
      activities_without_objectives:
        documentType === 'course_description'
          ? []
          : coverage.activitiesWithoutObjectives.map((id) => named(byId.get(id) as Activity)),
      unclassified_activities:
        documentType === 'course_description'
          ? []
          : real.filter((a) => a.ceiling === null && a.objectiveIds.length).map(named),
      unmatched_rows: unmatchedRows,
    },
    distribution: {
      target: coverage.distribution.target,
      practised: coverage.distribution.practised,
      audience_check: audienceCheck,
    },
    limits: LIMITS_BY_TYPE[documentType],
  };
}

/** One line per objective, for people reading the tool result. */
export function summarise(result: AlignmentOutput): string {
  const s = result.summary;
  const lines = [
    `check_alignment ${result.course_id} · ${result.document.type} (${result.document.language}, ${result.document.source}): ` +
      `${s.objectives} objectives · ${s.covered} covered · ${s.partial} partial · ${s.unclear} unclear · ${s.missing} missing · ` +
      `${s.needs_judgment_high} need judgment (high).`,
    'Evidence status only. The verdict (met / weak / missed) is yours: use needs_judgment and rubric://bloom.',
    '',
    '| Objective | Level | Status | Best evidence | Findings |',
    '|---|---|---|---|---|',
  ];
  for (const o of result.objectives) {
    const best = o.evidence[0];
    const where = best
      ? `${best.activity} (${best.location}, ${best.via}, ${best.ceiling ?? 'type unclear'})`
      : '–';
    lines.push(
      `| ${o.id} | ${o.level ?? '–'} | ${o.status}${o.over_covered ? ', over-covered' : ''} | ${where} | ${o.findings.map((f) => f.code).join(', ') || '–'} |`,
    );
  }
  const h = result.hygiene;
  if (h.unknown_references.length)
    lines.push('', `Unknown references: ${h.unknown_references.join('; ')}`);
  if (h.unclassified_activities.length)
    lines.push('', `Activity type not recognised: ${h.unclassified_activities.join('; ')}`);
  if (h.unmatched_rows.length)
    lines.push('', `Rows without a matching objective: ${h.unmatched_rows.join('; ')}`);
  return lines.join('\n');
}
