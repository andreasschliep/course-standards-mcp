/**
 * Prompt template validate_course_material (design section 9): the workflow the model
 * follows. It is a prompt, not a tool, because the steps need the model's judgment;
 * every MCP client can offer it (in Claude Code: /course-standards:validate_course_material).
 */
import { completable, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ServerDeps } from './deps.ts';

const DOCUMENT_TYPES = ['facilitation_plan', 'mapping_document', 'course_description'] as const;
const LANGUAGES = ['de', 'de-CH', 'en'] as const;

const startsWith = (options: readonly string[]) => (value: string | undefined) =>
  options.filter((o) => o.startsWith(value ?? ''));

export function validationPrompt(args: {
  course_id: string;
  document: string;
  document_type: string;
  language: string;
}): string {
  const german = args.language !== 'en';
  const looksLikePath = /^[^\n]{1,300}\.(md|markdown|csv|ya?ml|txt)$/i.test(args.document.trim());
  const documentArg = looksLikePath
    ? `{ "path": ${JSON.stringify(args.document.trim())} }`
    : '{ "text": <the document text below> }';
  const format = /\.csv$/i.test(args.document.trim()) ? ', format: "csv"' : '';
  const report = german
    ? [
        'Write the report in German:',
        '1. Table "Lernziel · Status (erfüllt / schwach / verfehlt) · Begründung · Fundstelle · Vorschlag", one row per learning objective.',
        '2. Table "Begriff · Fundstelle · Befund · Vorschlag" for the term findings.',
        '3. Short list "Was der Server nicht entscheiden konnte": every objective you judged from keyword candidates or unclear activity types, and every hygiene note.',
      ]
    : [
        'Write the report in English:',
        '1. Table "Objective · Status (met / weak / missed) · Reason · Location · Suggestion", one row per learning objective.',
        '2. Table "Term · Location · Finding · Suggestion" for the term findings.',
        '3. Short list "What the server could not decide": every objective you judged from keyword candidates or unclear activity types, and every hygiene note.',
      ];
  return [
    `Validate course material for course ${args.course_id} against its learning objectives and the term base.`,
    '',
    'Steps:',
    `1. Call list_learning_objectives with course_id "${args.course_id}".`,
    '2. Read the resource rubric://bloom.',
    `3. Call check_alignment with course_id "${args.course_id}", document ${documentArg}, document_type "${args.document_type}", language "${args.language}"${format}.`,
    '4. For every objective with needs_judgment.priority "high", and for a sample of the "low" ones, decide met, weak or missed with the criteria for its level (criteria_by_level in the result, details in rubric://bloom):',
    '   - answer the needs_judgment question from what the document says participants do, not from activity labels;',
    '   - cite the location (lines or row) of the evidence;',
    '   - never call an objective met without a location; keyword candidates alone are never enough for met;',
    '   - for weak or missed, propose one concrete change (an activity at the target level, with minutes).',
    `5. Call check_terms with the same document and language "${args.language}".`,
    '6. Report.',
    ...report,
    '',
    'The server reports evidence; the verdict is yours. Say so when you are unsure.',
    ...(looksLikePath ? [] : ['', 'Document:', '', args.document]),
  ].join('\n');
}

export function registerPrompts(server: McpServer, deps: ServerDeps): void {
  server.registerPrompt(
    'validate_course_material',
    {
      title: 'Validate course material',
      description:
        'Check a facilitation plan, mapping document or course description against the learning ' +
        'objectives of a course and the term base, judge each objective with the Bloom rubric, and ' +
        'report met / weak / missed with locations and suggestions.',
      argsSchema: z.object({
        course_id: completable(z.string().describe('Course id, e.g. ADB'), (value) =>
          [...deps.catalogs().courses.keys()].filter((id) => id.startsWith(value ?? '')).sort(),
        ),
        document: z
          .string()
          .describe('Path to the document under an allowed folder, or the document text itself'),
        document_type: completable(
          z.string().describe(DOCUMENT_TYPES.join(' | ')),
          startsWith(DOCUMENT_TYPES),
        ),
        language: completable(z.string().describe(LANGUAGES.join(' | ')), startsWith(LANGUAGES)),
      }),
    },
    (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: validationPrompt(args) } }],
    }),
  );
}
