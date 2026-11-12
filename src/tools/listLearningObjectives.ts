/**
 * list_learning_objectives: the objectives of a course (id, English text, Bloom level),
 * optionally with the wording lint from learning-objective-lint. Without course_id it
 * lists the available courses instead (design D4: no separate list_courses tool).
 */
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { lintObjective } from 'learning-objective-lint';
import { getCatalog } from '../data/catalogs.ts';
import type { ServerDeps } from '../deps.ts';
import { DomainError, guarded, success } from '../errors.ts';
import { listInput, listOutput, type ListOutput } from '../schemas.ts';

export interface ListArgs {
  course_id?: string | undefined;
  module_id?: string | undefined;
  include_lint?: boolean | undefined;
}

export function listLearningObjectives(args: ListArgs, deps: ServerDeps): CallToolResult {
  const index = deps.catalogs();

  if (!args.course_id) {
    const courses = [...index.courses.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        title: c.title,
        version: c.version,
        objectives: c.objectives.length,
      }));
    const data: ListOutput = { courses };
    if (index.problems.length)
      data.catalog_problems = index.problems.map((p) => ({
        file: p.file.split('/').pop() ?? p.file,
        message: p.message,
      }));
    const text =
      `${courses.length} course(s): ${courses.map((c) => `${c.id} (${c.title}, ${c.objectives} objectives)`).join('; ') || 'none'}.` +
      (index.problems.length
        ? ` ${index.problems.length} catalog file(s) could not be read.`
        : '') +
      ' Call again with course_id to see the objectives.';
    return success(text, data);
  }

  const catalog = getCatalog(index, args.course_id);
  let objectives = catalog.objectives;
  if (args.module_id) {
    objectives = objectives.filter((o) => o.moduleId === args.module_id);
    if (!objectives.length) {
      const modules = [...new Set(catalog.objectives.map((o) => o.moduleId))].join(', ');
      throw new DomainError(
        'unknown_module',
        `Course ${catalog.id} has no module "${args.module_id}".`,
        `Modules of ${catalog.id}: ${modules}. Omit module_id to list all objectives.`,
      );
    }
  }

  const data: ListOutput = {
    course: {
      id: catalog.id,
      title: catalog.title,
      version: catalog.version,
      audience_level: catalog.audienceLevel,
    },
    objectives: objectives.map((o) => ({
      id: o.id,
      module_id: o.moduleId,
      module_title: o.moduleTitle,
      level: o.level,
      text: o.text,
    })),
  };
  if (args.include_lint) {
    data.lint = objectives.map((o) => {
      const result = lintObjective({ id: o.id, level: o.level, text: o.text });
      return {
        id: o.id,
        worst_status: result.worstStatus,
        findings: result.results
          .filter((r) => r.status !== 'pass')
          .map((r) => ({
            rule: r.ruleId,
            status: r.status as 'warn' | 'fail',
            message: r.message ?? '',
          })),
      };
    });
  }

  const lines = [
    `${catalog.id} · ${catalog.title} · version ${catalog.version} · ${objectives.length} objectives`,
    ...objectives.map((o) => `- ${o.id} [${o.level ?? 'no level'}] ${o.text}`),
  ];
  if (data.lint) {
    const flagged = data.lint.filter((l) => l.worst_status !== 'pass');
    lines.push(
      '',
      `Wording lint: ${flagged.length ? flagged.map((l) => `${l.id} ${l.worst_status} (${l.findings.map((f) => f.rule).join(', ')})`).join('; ') : 'no findings'}.`,
    );
  }
  return success(lines.join('\n'), data);
}

export function registerListLearningObjectives(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'list_learning_objectives',
    {
      title: 'List learning objectives',
      description:
        'Learning objectives of a course: id, English text and Bloom level (Remember, Understand, ' +
        'Apply, Analyse, Evaluate, Create). Without course_id: the list of available courses. ' +
        'With include_lint: also a check of the wording of each objective. Read-only.',
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => guarded('list_learning_objectives', () => listLearningObjectives(args, deps)),
  );
}
