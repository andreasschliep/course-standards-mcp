/**
 * The Bloom rubric (data/rubric/bloom.yaml): levels with criteria, activity types with
 * cues and level ceilings, verdict definitions and judgment questions.
 *
 * The server reads it on every call; the same file is rendered as rubric://bloom for the
 * model (design section 8).
 */
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { z } from 'zod';
import { BLOOM_LEVELS, type BloomLevel } from 'learning-objective-lint';
import { makeCue, type Cue } from '../text.ts';

const bloomLevel = z.enum(BLOOM_LEVELS as unknown as [BloomLevel, ...BloomLevel[]]);
const bilingual = z.object({ en: z.array(z.string()), de: z.array(z.string()) });

const rubricSchema = z.object({
  version: z.string(),
  levels: z.array(
    z.object({
      id: bloomLevel,
      description: z.string(),
      verbs: bilingual,
      met_evidence: z.string(),
      weak_signs: z.string(),
      criteria: z.array(z.string()).min(1),
    }),
  ),
  activity_types: z.array(
    z.object({
      id: z.string(),
      ceiling: bloomLevel.nullable(),
      ignore: z.boolean().optional(),
      passive: z.boolean().optional(),
      cues: bilingual,
    }),
  ),
  verdicts: z.object({ met: z.string(), weak: z.string(), missed: z.string() }),
  questions: z.object({
    covered: z.string(),
    partial: z.string(),
    unclear: z.string(),
    missing_with_candidates: z.string(),
    missing: z.string(),
  }),
});

export type RubricData = z.infer<typeof rubricSchema>;

export interface ActivityType {
  id: string;
  ceiling: BloomLevel | null;
  ignore: boolean;
  passive: boolean;
  cues: Cue[];
}

export interface Rubric {
  data: RubricData;
  activityTypes: ActivityType[];
  criteriaFor(level: BloomLevel): string[];
}

export function loadRubric(file: string): Rubric {
  const data = rubricSchema.parse(yaml.load(readFileSync(file, 'utf8')));
  const activityTypes = data.activity_types.map((t) => ({
    id: t.id,
    ceiling: t.ceiling,
    ignore: t.ignore ?? false,
    passive: t.passive ?? false,
    cues: [...t.cues.de.map((c) => makeCue(c, 'de')), ...t.cues.en.map((c) => makeCue(c, 'en'))],
  }));
  return {
    data,
    activityTypes,
    criteriaFor: (level) => data.levels.find((l) => l.id === level)?.criteria ?? [],
  };
}

/** rubric://bloom as Markdown for the model. */
export function renderRubric(rubric: Rubric): string {
  const { data } = rubric;
  const lines = [
    `# Bloom rubric (version ${data.version})`,
    '',
    'Use this rubric to turn the evidence from check_alignment into a verdict per learning objective.',
    'The server reports evidence (covered, partial, unclear, missing). You decide met, weak or missed.',
    '',
    '## Verdicts',
    '',
    `- **met:** ${data.verdicts.met}`,
    `- **weak:** ${data.verdicts.weak}`,
    `- **missed:** ${data.verdicts.missed}`,
    '',
    'Never give *met* without citing the location of the evidence.',
    '',
    '## Levels',
    '',
  ];
  for (const level of data.levels) {
    lines.push(`### ${level.id}`, '', level.description, '');
    lines.push(`- Verbs (EN): ${level.verbs.en.join(', ')}`);
    lines.push(`- Verbs (DE): ${level.verbs.de.join(', ')}`);
    lines.push(`- Evidence for *met*: ${level.met_evidence}`);
    lines.push(`- Signs of *weak*: ${level.weak_signs}`);
    lines.push(`- Criteria: ${level.criteria.join(' ')}`, '');
  }
  lines.push(
    '## Activity types',
    '',
    'The server infers the type of an activity from cue words and uses the highest level the type plausibly reaches (its ceiling). A label is not what participants do: check the description.',
    '',
    '| Type | Ceiling | Cues (DE) | Cues (EN) |',
    '|---|---|---|---|',
  );
  for (const t of data.activity_types) {
    const ceiling = t.ignore ? 'ignored' : (t.ceiling ?? 'unclear');
    lines.push(`| ${t.id} | ${ceiling} | ${t.cues.de.join(', ')} | ${t.cues.en.join(', ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}
