/**
 * Learning-objective catalogs.
 *
 * Format: the learning-objective-lint objectives YAML, so existing catalogs work
 * unchanged. The library validates them (parseObjectives); this module adds the keys
 * the library ignores:
 *   metadata.references   how documents cite objectives (prefixes, id_template)
 *   objectives[].keywords optional keywords per language, for candidate passages
 *   composition.shared    an included file with shared objectives (existing convention)
 * and an optional side file <id>.references.yaml, so real catalogs can be used without
 * editing them.
 *
 * Catalogs are read on every call (design D11): they are small, and an edited file
 * takes effect without restarting the client.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import yaml from 'js-yaml';
import {
  InputError,
  parseObjectives,
  type BloomLevel,
  type ObjectivesDoc,
} from 'learning-objective-lint';
import { DomainError } from '../errors.ts';
import { logWarn } from '../logger.ts';

export interface ReferenceConfig {
  prefixes: string[];
  idTemplate: string;
}

export interface CatalogObjective {
  id: string;
  level: BloomLevel | null;
  text: string;
  moduleId: string;
  moduleTitle: string;
  keywords: { de: string[]; en: string[] };
}

export interface Catalog {
  id: string;
  title: string;
  version: string;
  audienceLevel: string | null;
  file: string;
  references: ReferenceConfig;
  objectives: CatalogObjective[];
  /** As parsed by the library; passed to computeCoverage. */
  doc: ObjectivesDoc;
}

export interface CatalogIndex {
  courses: Map<string, Catalog>;
  /** Files that look like catalogs but could not be read: reported, not fatal. */
  problems: Array<{ file: string; message: string }>;
}

export const DEFAULT_REFERENCES: ReferenceConfig = {
  prefixes: ['LO', 'LOs', 'Lernziel', 'Lernziele', 'Learning objective', 'Learning objectives'],
  idTemplate: '{n}',
};

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function readYaml(file: string): unknown {
  return yaml.load(readFileSync(file, 'utf8'));
}

/** True when `file` resolves to a path inside `dir`. */
function inside(dir: string, file: string): boolean {
  const root = realpathSync(dir);
  const target = realpathSync(file);
  return target === root || target.startsWith(root + sep);
}

/** Prepends the modules of composition.shared.file, if the catalog includes one. */
function withSharedModules(raw: Raw, file: string): Raw {
  const composition = isObject(raw.composition) ? raw.composition : undefined;
  const shared = composition && isObject(composition.shared) ? composition.shared : undefined;
  if (!shared || typeof shared.file !== 'string' || shared.included === false) return raw;
  const dir = dirname(file);
  const sharedFile = join(dir, shared.file);
  if (!existsSync(sharedFile) || !inside(dir, sharedFile)) {
    throw new InputError(
      `${basename(file)}: shared file "${shared.file}" not found in the catalog folder`,
    );
  }
  const sharedRaw = readYaml(sharedFile);
  const sharedModules =
    isObject(sharedRaw) && Array.isArray(sharedRaw.modules) ? sharedRaw.modules : [];
  const own = Array.isArray(raw.modules) ? raw.modules : [];
  return { ...raw, modules: [...sharedModules, ...own] };
}

function referencesFrom(value: unknown): Partial<ReferenceConfig> {
  if (!isObject(value)) return {};
  const out: Partial<ReferenceConfig> = {};
  const prefixes = strings(value.prefixes);
  if (prefixes.length) out.prefixes = prefixes;
  if (typeof value.id_template === 'string' && value.id_template.includes('{n}')) {
    out.idTemplate = value.id_template;
  }
  return out;
}

function keywordsByObjective(raw: Raw): Map<string, { de: string[]; en: string[] }> {
  const map = new Map<string, { de: string[]; en: string[] }>();
  for (const mod of Array.isArray(raw.modules) ? raw.modules : []) {
    if (!isObject(mod)) continue;
    for (const lo of Array.isArray(mod.objectives) ? mod.objectives : []) {
      if (!isObject(lo) || lo.id == null || !isObject(lo.keywords)) continue;
      map.set(String(lo.id), { de: strings(lo.keywords.de), en: strings(lo.keywords.en) });
    }
  }
  return map;
}

function loadCatalog(file: string, sideFiles: Map<string, Raw>): Catalog | null {
  const raw = readYaml(file);
  if (!isObject(raw) || !Array.isArray(raw.modules) || !isObject(raw.metadata)) return null;
  const meta = raw.metadata;
  if (meta.id == null || meta.type === 'shared') return null; // shared parts are included, not listed
  const id = String(meta.id);
  const full = withSharedModules(raw, file);
  const doc = parseObjectives(full, basename(file));
  const keywords = keywordsByObjective(full);
  const side = sideFiles.get(id);
  return {
    id,
    title:
      typeof meta.title === 'string' ? meta.title : typeof meta.name === 'string' ? meta.name : id,
    version: meta.version != null ? String(meta.version) : 'unversioned',
    audienceLevel: typeof meta.audience_level === 'string' ? meta.audience_level : null,
    file,
    references: {
      ...DEFAULT_REFERENCES,
      ...referencesFrom(meta.references),
      ...referencesFrom(side?.references ?? side),
    },
    objectives: doc.objectives.map((lo) => ({
      ...lo,
      keywords: keywords.get(lo.id) ?? { de: [], en: [] },
    })),
    doc,
  };
}

/** Reads every catalog folder; a later folder overrides a course id from an earlier one. */
export function loadCatalogs(dirs: string[]): CatalogIndex {
  const courses = new Map<string, Catalog>();
  const problems: CatalogIndex['problems'] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      problems.push({ file: dir, message: 'catalog folder does not exist' });
      continue;
    }
    const files = readdirSync(dir)
      .filter((f) => /\.ya?ml$/i.test(f))
      .sort();
    const sideFiles = new Map<string, Raw>();
    for (const f of files.filter((f) => /\.references\.ya?ml$/i.test(f))) {
      const raw = readYaml(join(dir, f));
      if (isObject(raw)) sideFiles.set(f.replace(/\.references\.ya?ml$/i, ''), raw);
    }
    for (const f of files.filter((f) => !/\.references\.ya?ml$/i.test(f))) {
      const file = join(dir, f);
      try {
        const catalog = loadCatalog(file, sideFiles);
        if (!catalog) continue;
        if (courses.has(catalog.id))
          logWarn(`course ${catalog.id} from ${file} overrides an earlier folder`);
        courses.set(catalog.id, catalog);
      } catch (error) {
        const message =
          error instanceof InputError || error instanceof Error ? error.message : String(error);
        problems.push({ file, message });
      }
    }
  }
  return { courses, problems };
}

export function getCatalog(index: CatalogIndex, courseId: string): Catalog {
  const catalog = index.courses.get(courseId);
  if (catalog) return catalog;
  const broken = index.problems.find((p) => basename(p.file).replace(/\.ya?ml$/i, '') === courseId);
  if (broken) {
    throw new DomainError(
      'invalid_catalog',
      `The catalog for course "${courseId}" is invalid: ${broken.message}`,
      'Fix the catalog file; the problems are listed above. The tool cannot work around them.',
    );
  }
  const available = [...index.courses.keys()].sort().join(', ') || 'none';
  throw new DomainError(
    'unknown_course',
    `There is no course "${courseId}".`,
    `Available course ids: ${available}. Call list_learning_objectives without course_id to see titles.`,
  );
}
