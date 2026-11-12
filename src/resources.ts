/**
 * Resources: read-only context the model can load (design section 8).
 *
 * course://{course_id}/learning-objectives  the normalized catalog of one course
 * rubric://bloom                             levels, criteria, activity types, verdicts
 * termbase://en-de                           the term base (data licence CC BY-SA 4.0)
 *
 * Resources have no isError channel: an unknown course is a JSON-RPC error
 * (ResourceNotFoundError, -32602 since 2026-07-28).
 */
import {
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
} from '@modelcontextprotocol/server';
import type { ServerDeps } from './deps.ts';
import { renderRubric } from './data/rubric.ts';

export function registerResources(server: McpServer, deps: ServerDeps): void {
  server.registerResource(
    'course-learning-objectives',
    new ResourceTemplate('course://{course_id}/learning-objectives', {
      list: () => ({
        resources: [...deps.catalogs().courses.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((c) => ({
            uri: `course://${c.id}/learning-objectives`,
            name: `${c.id} learning objectives`,
            title: `${c.title}: learning objectives`,
            mimeType: 'application/json',
          })),
      }),
      complete: {
        course_id: (value) =>
          [...deps.catalogs().courses.keys()].filter((id) => id.startsWith(value)).sort(),
      },
    }),
    {
      title: 'Learning objectives of a course',
      description:
        'The catalog of one course: objectives with id, English text and Bloom level, by module.',
      mimeType: 'application/json',
    },
    (uri, variables) => {
      const courseId = String(variables.course_id ?? '');
      const catalog = deps.catalogs().courses.get(courseId);
      if (!catalog) throw new ResourceNotFoundError(uri.href);
      const body = {
        course: {
          id: catalog.id,
          title: catalog.title,
          version: catalog.version,
          audience_level: catalog.audienceLevel,
        },
        objectives: catalog.objectives.map((o) => ({
          id: o.id,
          module_id: o.moduleId,
          module_title: o.moduleTitle,
          level: o.level,
          text: o.text,
        })),
      };
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'bloom-rubric',
    'rubric://bloom',
    {
      title: 'Bloom rubric',
      description:
        'How to judge the evidence from check_alignment: what participants observably do at each ' +
        'Bloom level (verbs EN/DE), activity types and their level ceilings, and the definitions of ' +
        'met, weak and missed.',
      mimeType: 'text/markdown',
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderRubric(deps.rubric()) }],
    }),
  );

  // One language pair in version 1, so a fixed URI. With a second pair this becomes the
  // template termbase://{source}-{target} from the design.
  server.registerResource(
    'termbase-en-de',
    'termbase://en-de',
    {
      title: 'Term base English → German',
      description:
        'Scrum terms with the official German form (Scrum Guide 2020, German translation), accepted ' +
        'variants, deprecated and wrong forms, and sources. Licence of the data: CC BY-SA 4.0.',
      mimeType: 'application/json',
    },
    (uri) => {
      // Everything except the local file path.
      const { version, languages, license, sources, terms } = deps.termbase();
      const termbase = { version, languages, license, sources, terms };
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(termbase, null, 2) },
        ],
      };
    },
  );
}
