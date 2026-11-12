/**
 * check_alignment: a document against the objectives of a course. Deterministic evidence
 * per objective plus the question the model has to answer (design section 6.2). The
 * logic is in src/alignment.ts and the extractors; this file is the MCP boundary.
 */
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import {
  checkAlignment,
  summarise,
  type DocumentType,
  type Format,
  type Language,
} from '../alignment.ts';
import { getCatalog } from '../data/catalogs.ts';
import type { ServerDeps } from '../deps.ts';
import { loadDocument, type DocumentInput } from '../documents.ts';
import { guarded, success } from '../errors.ts';
import { alignmentInput, alignmentOutput } from '../schemas.ts';

export interface AlignmentArgs {
  course_id: string;
  document: DocumentInput;
  document_type: DocumentType;
  format?: Format | undefined;
  language: Language;
  objective_ids?: string[] | undefined;
  max_evidence?: number | undefined;
}

export function runCheckAlignment(args: AlignmentArgs, deps: ServerDeps): CallToolResult {
  const catalog = getCatalog(deps.catalogs(), args.course_id);
  const doc = loadDocument(args.document, deps.config.docRoots);
  const result = checkAlignment({
    catalog,
    rubric: deps.rubric(),
    termbase: deps.termbase(),
    text: doc.text,
    source: doc.source,
    documentType: args.document_type,
    format: args.format ?? (doc.source.toLowerCase().endsWith('.csv') ? 'csv' : 'markdown'),
    language: args.language,
    objectiveIds: args.objective_ids,
    maxEvidence: args.max_evidence ?? 3,
  });
  return success(summarise(result), result);
}

export function registerCheckAlignment(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'check_alignment',
    {
      title: 'Check a document against learning objectives',
      description:
        'Check a facilitation plan, mapping document or course description (German or English) ' +
        'against the English Bloom-level objectives of a course. Returns evidence per objective: ' +
        'status covered / partial / unclear / missing, locations, activity types, minutes, findings ' +
        'such as passive_only, and needs_judgment with the question you must answer. The server ' +
        'never decides whether an objective is met: you do, with the criteria given and the ' +
        'resource rubric://bloom. Pass long documents by path. Read-only.',
      inputSchema: alignmentInput,
      outputSchema: alignmentOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => guarded('check_alignment', () => runCheckAlignment(args, deps)),
  );
}
