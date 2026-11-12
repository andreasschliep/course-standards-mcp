/**
 * What the tools and resources need, loaded fresh on every call (design D11):
 * catalogs and rubric are small files, and an edit takes effect without a restart.
 * Tests pass their own config.
 */
import { loadConfig, type Config } from './config.ts';
import { loadCatalogs, type CatalogIndex } from './data/catalogs.ts';
import { loadRubric, type Rubric } from './data/rubric.ts';

export interface ServerDeps {
  config: Config;
  catalogs(): CatalogIndex;
  rubric(): Rubric;
}

export function defaultDeps(config: Config = loadConfig()): ServerDeps {
  return {
    config,
    catalogs: () => loadCatalogs(config.courseDirs),
    rubric: () => loadRubric(config.rubricFile),
  };
}
