/**
 * check_terms and lookup_term: the MCP boundary for src/terms.ts (design 6.3, 6.4).
 */
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { ServerDeps } from '../deps.ts';
import { loadDocument, type DocumentInput } from '../documents.ts';
import { guarded, success } from '../errors.ts';
import {
  lookupInput,
  lookupOutput,
  termsInput,
  termsOutput,
  type TermsOutput,
} from '../schemas.ts';
import { checkTerms, lookupTerm, type TermCategory, type TermLanguage } from '../terms.ts';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface TermsArgs {
  document: DocumentInput;
  language: TermLanguage;
  categories?: TermCategory[] | undefined;
}

export function runCheckTerms(args: TermsArgs, deps: ServerDeps): CallToolResult {
  const doc = loadDocument(args.document, deps.config.docRoots);
  const termbase = deps.termbase();
  const findings = checkTerms(doc.text, args.language, termbase, args.categories);
  const count = (c: TermCategory) => findings.filter((f) => f.category === c).length;
  const data: TermsOutput = {
    language: args.language,
    source: doc.source,
    termbase: {
      version: termbase.version,
      license: termbase.license,
      terms: termbase.terms.length,
    },
    summary: {
      findings: findings.length,
      deprecated: count('deprecated'),
      keep_english: count('keep_english'),
      wrong_translation: count('wrong_translation'),
      locale: count('locale'),
    },
    findings,
  };
  const lines = [
    `check_terms (${args.language}, ${doc.source}): ${findings.length} finding(s).`,
    ...findings.map(
      (f) =>
        `- line ${f.line}:${f.column} [${f.severity}, ${f.category}] "${f.found}" → "${f.suggestion}"${f.note ? ` (${f.note})` : ''}`,
    ),
  ];
  if (!findings.length) lines.push('No deprecated or wrong terms found.');
  return success(lines.join('\n'), data);
}

export function runLookupTerm(args: { term: string }, deps: ServerDeps): CallToolResult {
  const result = lookupTerm(args.term, deps.termbase());
  const text = result.found
    ? result.entries
        .map(
          (e) =>
            `${e.en} → ${e.de}${e.keep_english ? ' (stays English in German texts)' : ''}; matched as ${e.matched_as}` +
            `${e.de_variants.length ? `; also accepted: ${e.de_variants.join(', ')}` : ''}` +
            `${e.deprecated_forms.length ? `; deprecated: ${e.deprecated_forms.join(', ')}` : ''}` +
            `. Source: ${e.source_title}.${e.note ? ` ${e.note}` : ''}`,
        )
        .join('\n')
    : `"${args.term}" is not in the term base.${result.suggestions.length ? ` Did you mean: ${result.suggestions.join(', ')}?` : ''}`;
  return success(text, result);
}

export function registerTermTools(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'check_terms',
    {
      title: 'Check terms against the term base',
      description:
        'Check a German or English text against the Scrum term base: deprecated terms (e.g. ' +
        '"Development Team"), core terms that must stay English but were translated, unofficial ' +
        'German forms, and for de-CH every "ß". Each finding has line, column, a suggestion and the ' +
        'source. Does not translate or change the text. Pass long documents by path. Read-only.',
      inputSchema: termsInput,
      outputSchema: termsOutput,
      annotations: READ_ONLY,
    },
    (args) => guarded('check_terms', () => runCheckTerms(args, deps)),
  );

  server.registerTool(
    'lookup_term',
    {
      title: 'Look up a term',
      description:
        'Look up an English or German Scrum term: official German form, accepted variants, whether ' +
        'it stays English, deprecated and wrong forms, and the source. A term that is not in the ' +
        'term base is a normal answer (found: false, with suggestions). Read-only.',
      inputSchema: lookupInput,
      outputSchema: lookupOutput,
      annotations: READ_ONLY,
    },
    (args) => guarded('lookup_term', () => runLookupTerm(args, deps)),
  );
}
