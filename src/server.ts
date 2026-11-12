#!/usr/bin/env node
/**
 * course-standards-mcp: MCP server over stdio.
 *
 * stdout carries JSON-RPC messages only. Everything else (startup, errors) goes to
 * stderr through src/logger.ts.
 */
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { defaultDeps, type ServerDeps } from './deps.ts';
import { logError, logInfo } from './logger.ts';
import { registerPrompts } from './prompts.ts';
import { registerResources } from './resources.ts';
import { registerCheckAlignment } from './tools/checkAlignment.ts';
import { registerListLearningObjectives } from './tools/listLearningObjectives.ts';
import { registerTermTools } from './tools/terms.ts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const INSTRUCTIONS =
  'Checks course material against Bloom-level learning objectives. Order: list_learning_objectives, ' +
  'read rubric://bloom, check_alignment, then judge every objective with needs_judgment.priority ' +
  '"high" as met, weak or missed, citing the evidence location. The server reports evidence only; ' +
  'the verdict is yours. Never call an objective met without a location. check_terms finds ' +
  'deprecated and wrong Scrum terms; lookup_term explains one term. The prompt ' +
  'validate_course_material runs the whole check.';

export function createServer(deps: ServerDeps = defaultDeps()): McpServer {
  const server = new McpServer(
    { name: 'course-standards-mcp', version },
    { instructions: INSTRUCTIONS },
  );
  registerListLearningObjectives(server, deps);
  registerCheckAlignment(server, deps);
  registerTermTools(server, deps);
  registerResources(server, deps);
  registerPrompts(server, deps);
  return server;
}

async function main(): Promise<void> {
  const deps = defaultDeps();
  const server = createServer(deps);
  await server.connect(new StdioServerTransport());
  const courses = deps.catalogs().courses.size;
  logInfo(
    `v${version} ready on stdio; ${courses} course(s) from ${deps.config.courseDirs.length} folder(s)`,
  );
}

/** True when this file is the process entry point (not imported by a test). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    logError('failed to start', error);
    process.exit(1);
  });
}
