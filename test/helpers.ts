/**
 * Test helpers. Every test uses the fictional data in data/ and examples/, or the
 * fictional example that ships with learning-objective-lint.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { loadConfig } from '../src/config.ts';
import { getCatalog, loadCatalogs } from '../src/data/catalogs.ts';
import { loadRubric } from '../src/data/rubric.ts';
import { defaultDeps, type ServerDeps } from '../src/deps.ts';

export const REPO = fileURLToPath(new URL('..', import.meta.url));
export const EXAMPLES = join(REPO, 'examples');

/** learning-objective-lint's own fictional example (objectives + agenda). */
export const LIB_EXAMPLE = join(
  dirname(createRequire(import.meta.url).resolve('learning-objective-lint/package.json')),
  'examples',
  'testing-fundamentals',
);

export function deps(overrides: Partial<ReturnType<typeof loadConfig>> = {}): ServerDeps {
  return defaultDeps({ ...loadConfig({}), ...overrides });
}

export const rubric = () => loadRubric(loadConfig({}).rubricFile);
export const adb = () => getCatalog(loadCatalogs(loadConfig({}).courseDirs), 'ADB');

export function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === 'text' ? first.text : '';
}
