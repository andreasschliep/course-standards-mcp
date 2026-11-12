/**
 * The term base (data/termbase/en-de.yaml): official German forms of Scrum terms,
 * accepted variants, deprecated forms and known wrong forms, each with a source.
 * Read on every call, like the catalogs (design D11).
 */
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { z } from 'zod';

const severity = z.enum(['error', 'warn', 'info']);
const form = z.union([z.string(), z.object({ form: z.string(), severity: severity.optional() })]);

const termSchema = z.object({
  id: z.string(),
  en: z.string(),
  de: z.string(),
  de_variants: z.array(z.string()).default([]),
  keep_english: z.boolean(),
  deprecated: z.array(z.string()).default([]),
  wrong_de: z.array(form).default([]),
  wrong_en: z.array(form).default([]),
  severity: severity.default('warn'),
  allow_in: z.array(z.string()).default([]),
  source: z.string(),
  note: z.string().optional(),
});

const termbaseSchema = z.object({
  version: z.string(),
  languages: z.object({ source: z.string(), target: z.string() }),
  license: z.string(),
  sources: z.record(
    z.string(),
    z.object({ title: z.string(), url: z.string(), license: z.string() }),
  ),
  terms: z.array(termSchema),
});

export type Severity = z.infer<typeof severity>;
export type Term = z.infer<typeof termSchema>;
export type Termbase = z.infer<typeof termbaseSchema> & { file: string };

export function loadTermbase(file: string): Termbase {
  const data = termbaseSchema.parse(yaml.load(readFileSync(file, 'utf8')));
  const unknownSources = data.terms.filter((t) => !data.sources[t.source]).map((t) => t.id);
  if (unknownSources.length) {
    throw new Error(`${file}: terms with an unknown source: ${unknownSources.join(', ')}`);
  }
  return { ...data, file };
}

/** A wrong form with its effective severity. */
export function formsOf(
  list: Term['wrong_de'],
  fallback: Severity,
): Array<{ form: string; severity: Severity }> {
  return list.map((f) =>
    typeof f === 'string'
      ? { form: f, severity: fallback }
      : { form: f.form, severity: f.severity ?? fallback },
  );
}
