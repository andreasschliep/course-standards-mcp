/**
 * Mapping documents: one row per activity, as CSV (an Excel export) or as the first
 * Markdown table that has an objective column.
 *
 * Columns are found by their header (design 5.2):
 * - objective column: LO, ID, Lernziel, Learning objective, Objective, #
 *   A cell is resolved by reference ("LO 3", "1.4, 2.1", "ADB-3"); if that fails, by
 *   exact objective text (after normalising case, spaces and punctuation), because some
 *   templates repeat the objective text instead of an id.
 * - minutes column: Min, Minuten, Minutes, Dauer, Duration, Zeit, Time
 * - every other column is description; the first non-empty one is the title.
 */
import type { CatalogObjective, ReferenceConfig } from '../data/catalogs.ts';
import type { Rubric } from '../data/rubric.ts';
import { DomainError } from '../errors.ts';
import { fold } from '../text.ts';
import { classify, type Activity } from './activities.ts';
import { resolveCell } from './references.ts';

/** RFC 4180 CSV with quotes; the delimiter (",", ";" or tab) is taken from the header line. */
export function parseCsv(text: string): string[][] {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, header.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** All Markdown tables in a document, each with its first line number. */
export function parseMarkdownTables(text: string): Array<{ line: number; rows: string[][] }> {
  const lines = text.split(/\r?\n/);
  const tables: Array<{ line: number; rows: string[][] }> = [];
  let current: { line: number; rows: string[][] } | null = null;
  lines.forEach((line, i) => {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return; // separator row
      if (!current) {
        current = { line: i + 1, rows: [] };
        tables.push(current);
      }
      current.rows.push(cells);
    } else current = null;
  });
  return tables;
}

const OBJECTIVE_HEADER =
  /^(lo|los|id|lo id|#|nr|no|lernziele?|lernziel-id|learning objectives?|objectives?|lernziel \(.*\)|learning objective \(.*\))$/;
const OBJECTIVE_HEADER_LOOSE = /lernziel|learning objective|objective/;
const MINUTES_HEADER =
  /^(min|min\.|minuten|minutes|dauer|duration|zeit|time|zeit \(min\)|minutes \(min\))$/;

const normaliseText = (s: string) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function rowsToActivities(
  rows: string[][],
  firstLine: number | null,
  references: ReferenceConfig,
  objectives: CatalogObjective[],
  rubric: Rubric,
): { activities: Activity[]; unmatchedRows: string[] } {
  const [header = [], ...body] = rows;
  const names = header.map((h) => fold(h).replace(/\*/g, '').trim());
  let objectiveCol = names.findIndex((n) => OBJECTIVE_HEADER.test(n));
  if (objectiveCol < 0) objectiveCol = names.findIndex((n) => OBJECTIVE_HEADER_LOOSE.test(n));
  if (objectiveCol < 0) {
    throw new DomainError(
      'no_activities_found',
      'The table has no column for learning objectives.',
      'Name the column "LO", "Lernziel" or "Learning objective", or check the document_type.',
    );
  }
  const minutesCol = names.findIndex((n) => MINUTES_HEADER.test(n));
  const known = new Set(objectives.map((o) => o.id));
  const byText = new Map(objectives.map((o) => [normaliseText(o.text), o.id]));

  const activities: Activity[] = [];
  const unmatchedRows: string[] = [];
  body.forEach((cells, index) => {
    const rowNo = index + 1;
    const objectiveCell = cells[objectiveCol] ?? '';
    const refs = resolveCell(objectiveCell, references, known);
    if (!refs.ids.length && !refs.unknown.length) {
      const id = byText.get(normaliseText(objectiveCell));
      if (id) refs.ids.push(id);
    }
    const description = cells
      .filter((_, i) => i !== objectiveCol && i !== minutesCol)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!refs.ids.length && !refs.unknown.length && objectiveCell.trim()) {
      unmatchedRows.push(`row ${rowNo}: "${objectiveCell.trim().slice(0, 60)}"`);
    }
    const minutesValue =
      minutesCol >= 0 ? Number.parseFloat((cells[minutesCol] ?? '').replace(',', '.')) : NaN;
    const text = description.join(' · ');
    activities.push({
      id: `R${rowNo}`,
      title: description[0]?.slice(0, 80) ?? `row ${rowNo}`,
      location:
        firstLine === null ? `row ${rowNo}` : `row ${rowNo} (line ${firstLine + rowNo + 1})`,
      minutes: Number.isFinite(minutesValue) ? minutesValue : null,
      phase: null,
      text,
      body: text,
      objectiveIds: refs.ids,
      unknownReferences: refs.unknown,
      via: 'table_row',
      ...classify(text, rubric),
    });
  });
  return { activities, unmatchedRows };
}
