/**
 * Objective references in documents: "LO 3", "Lernziel 1.4, 2.1", "LO 3.1–3.5", "LO 1-6",
 * or a full catalog id such as "ADB-3" written out.
 *
 * Rules (design section 5.3):
 * - a number counts only after a prefix (LO, Lernziel, ...), so "1-6" in a schedule
 *   column is not taken for objectives; in a table's objective column a bare list is
 *   allowed (resolveCell);
 * - the number becomes a catalog id through the catalog's id_template ("ADB-{n}");
 * - a range is expanded only if every id it produces exists in the catalog;
 * - anything that does not resolve is reported as an unknown reference, never guessed.
 */
import type { ReferenceConfig } from '../data/catalogs.ts';

export interface References {
  ids: string[];
  unknown: string[];
}

const NUM = String.raw`\d+(?:\.\d+)*`;
const RANGE_SEP = String.raw`\s*(?:[-‐‑–—]|bis|to)\s*`;
const ITEM = `${NUM}(?:${RANGE_SEP}${NUM})?`;
const LIST_SEP = String.raw`\s*(?:,|;|/|&|\bund\b|\band\b)\s*`;
const LIST = `${ITEM}(?:${LIST_SEP}${ITEM})*`;
const MAX_RANGE = 50;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function expandItem(item: string, config: ReferenceConfig, known: Set<string>): References {
  const toId = (n: string) => config.idTemplate.replace('{n}', n);
  const parts = item.split(new RegExp(RANGE_SEP));
  if (parts.length === 1) {
    const id = toId(item.trim());
    return known.has(id) ? { ids: [id], unknown: [] } : { ids: [], unknown: [item.trim()] };
  }
  const [from = '', to = ''] = parts.map((p) => p.trim());
  const a = from.split('.');
  const b = to.split('.');
  const sameStem = a.length === b.length && a.slice(0, -1).join('.') === b.slice(0, -1).join('.');
  const start = Number(a.at(-1));
  const end = Number(b.at(-1));
  if (sameStem && end >= start && end - start <= MAX_RANGE) {
    const stem = a.slice(0, -1);
    const ids: string[] = [];
    for (let n = start; n <= end; n++) ids.push(toId([...stem, String(n)].join('.')));
    if (ids.every((id) => known.has(id))) return { ids, unknown: [] };
  }
  return { ids: [], unknown: [item.replace(/\s+/g, ' ').trim()] };
}

function expandList(list: string, config: ReferenceConfig, known: Set<string>): References {
  const out: References = { ids: [], unknown: [] };
  for (const item of list.match(new RegExp(ITEM, 'g')) ?? []) {
    const r = expandItem(item, config, known);
    out.ids.push(...r.ids);
    out.unknown.push(...r.unknown);
  }
  return out;
}

function unique(refs: References): References {
  return { ids: [...new Set(refs.ids)], unknown: [...new Set(refs.unknown)] };
}

/** All references in a passage of text. */
export function findReferences(
  text: string,
  config: ReferenceConfig,
  known: Set<string>,
): References {
  const out: References = { ids: [], unknown: [] };

  // 1. Prefix plus number list ("LO 1.4, 2.1", "Lernziele 3.1–3.5").
  const prefixes = [...config.prefixes].sort((x, y) => y.length - x.length).map(escape);
  if (prefixes.length) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${prefixes.join('|')})\\s*[:#]?\\s*(${LIST})`,
      'giu',
    );
    for (const match of text.matchAll(re)) {
      const r = expandList(match[1] ?? '', config, known);
      out.ids.push(...r.ids);
      out.unknown.push(...r.unknown.map((u) => `${match[0].split(/\s|:|#/)[0]} ${u}`));
    }
  }

  // 2. Catalog ids written out ("ADB-3", "SM1.2"). Only ids with a letter: a bare number
  //    such as "1.4" counts only after a prefix (it could be a version or a page).
  for (const id of known) {
    if (!/\p{L}/u.test(id)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}.-])${escape(id)}(?![\\p{L}\\p{N}]|\\.\\d)`, 'u');
    if (re.test(text)) out.ids.push(id);
  }
  return unique(out);
}

/**
 * A cell of a table's objective column. Accepts everything findReferences accepts, and
 * also a bare number list ("1.4, 2.1") because the column header already says what it is.
 */
export function resolveCell(cell: string, config: ReferenceConfig, known: Set<string>): References {
  const found = findReferences(cell, config, known);
  if (found.ids.length || found.unknown.length) return found;
  const bare = cell.trim();
  if (new RegExp(`^${LIST}$`).test(bare)) return unique(expandList(bare, config, known));
  return { ids: [], unknown: [] };
}
