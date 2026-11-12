/**
 * Input and output schemas of the tools (zod v4; the SDK turns them into JSON Schema).
 * Output schemas are declared so clients can validate structuredContent.
 */
import { z } from 'zod';

const bloomLevel = z.enum(['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create']);
const courseId = z
  .string()
  .regex(
    /^[A-Za-z0-9._-]{1,40}$/,
    'letters, digits, dot, dash or underscore; at most 40 characters',
  );

export const documentInput = z
  .union([
    z.object({ text: z.string().describe('The document text (Markdown or CSV).') }).strict(),
    z
      .object({
        path: z
          .string()
          .describe(
            'Path to a .md, .csv, .yaml or .txt file under an allowed folder (COURSE_STANDARDS_DOCS). Relative paths start in the first allowed folder.',
          ),
      })
      .strict(),
  ])
  .describe('Either { text } or { path }. Prefer path for long documents.');

// ---------------------------------------------------------------- list_learning_objectives

export const listInput = z.object({
  course_id: courseId.optional().describe('Omit to list the available courses.'),
  module_id: z.string().max(40).optional().describe('Only the objectives of this module.'),
  include_lint: z
    .boolean()
    .default(false)
    .describe('Also lint the wording of each objective (vague verbs, level mismatch, ...).'),
});

export const listOutput = z.object({
  courses: z
    .array(
      z.object({ id: z.string(), title: z.string(), version: z.string(), objectives: z.number() }),
    )
    .optional(),
  catalog_problems: z.array(z.object({ file: z.string(), message: z.string() })).optional(),
  course: z
    .object({
      id: z.string(),
      title: z.string(),
      version: z.string(),
      audience_level: z.string().nullable(),
    })
    .optional(),
  objectives: z
    .array(
      z.object({
        id: z.string(),
        module_id: z.string(),
        module_title: z.string(),
        level: bloomLevel.nullable(),
        text: z.string(),
      }),
    )
    .optional(),
  lint: z
    .array(
      z.object({
        id: z.string(),
        worst_status: z.enum(['pass', 'warn', 'fail']),
        findings: z.array(
          z.object({ rule: z.string(), status: z.enum(['warn', 'fail']), message: z.string() }),
        ),
      }),
    )
    .optional(),
});

export type ListOutput = z.infer<typeof listOutput>;

// ----------------------------------------------------------------------- check_alignment

export const alignmentInput = z.object({
  course_id: courseId,
  document: documentInput,
  document_type: z.enum(['facilitation_plan', 'mapping_document', 'course_description']),
  format: z
    .enum(['markdown', 'csv', 'agenda_yaml'])
    .default('markdown')
    .describe(
      'csv only for mapping documents; agenda_yaml (learning-objective-lint agenda) only for facilitation plans.',
    ),
  language: z
    .enum(['en', 'de', 'de-CH'])
    .describe('Language of the document, not of the objectives.'),
  objective_ids: z
    .array(z.string())
    .max(200)
    .optional()
    .describe('Limit the output to these objectives.'),
  max_evidence: z.number().int().min(1).max(5).default(3).describe('Evidence items per objective.'),
});

const evidence = z.object({
  activity: z.string(),
  location: z.string(),
  via: z.enum(['id_reference', 'table_row', 'agenda', 'keyword_match']),
  types: z.array(z.string()),
  ceiling: bloomLevel.nullable(),
  minutes: z.number().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  excerpt: z.string(),
  keyword_hits: z.array(z.string()).optional(),
});

const finding = z.object({
  code: z.enum(['passive_only', 'objective_wording', 'no_time']),
  severity: z.enum(['warn', 'info']),
  message: z.string(),
});

export const evidenceStatus = z.enum(['covered', 'partial', 'unclear', 'missing']);

export const alignmentOutput = z.object({
  course_id: z.string(),
  document: z.object({
    type: z.string(),
    format: z.string(),
    language: z.string(),
    source: z.string(),
    activities: z.number(),
    total_minutes: z.number().nullable(),
  }),
  summary: z.object({
    objectives: z.number(),
    covered: z.number(),
    partial: z.number(),
    unclear: z.number(),
    missing: z.number(),
    over_covered: z.number(),
    needs_judgment_high: z.number(),
  }),
  objectives: z.array(
    z.object({
      id: z.string(),
      level: bloomLevel.nullable(),
      text: z.string(),
      status: evidenceStatus,
      over_covered: z.boolean(),
      evidence: z.array(evidence),
      minutes: z.object({
        total: z.number().nullable(),
        active: z.number().nullable(),
        share_percent: z.number().nullable(),
      }),
      findings: z.array(finding),
      needs_judgment: z.object({
        priority: z.enum(['high', 'low']),
        question: z.string(),
        criteria: z.array(z.string()),
        rubric: z.literal('rubric://bloom'),
      }),
    }),
  ),
  hygiene: z.object({
    unknown_references: z.array(z.string()),
    activities_without_objectives: z.array(z.string()),
    unclassified_activities: z.array(z.string()),
    unmatched_rows: z.array(z.string()),
  }),
  distribution: z.object({
    target: z.record(z.string(), z.number()),
    practised: z.record(z.string(), z.number()),
    audience_check: z.string().nullable(),
  }),
  limits: z.array(z.string()),
});

export type AlignmentOutput = z.infer<typeof alignmentOutput>;
export type EvidenceStatus = z.infer<typeof evidenceStatus>;
