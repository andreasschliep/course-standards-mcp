/**
 * Configuration comes from the environment only (design section 10).
 *
 * COURSE_STANDARDS_COURSES  catalog folders, separated by ":"; a later folder overrides
 *                           a course id from an earlier one
 * COURSE_STANDARDS_DOCS     allowed roots for document.path, separated by ":"
 * COURSE_STANDARDS_TERMBASE the term base file (default: data/termbase/en-de.yaml)
 *
 * Defaults point at the fictional data in this repository, so the server works out of
 * the box and never touches real course data unless someone configures it.
 */
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  courseDirs: string[];
  docRoots: string[];
  termbaseFile: string;
  rubricFile: string;
}

/** Same relative path from src/ (tests) and dist/ (built server). */
const repoPath = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

function listFromEnv(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '')
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    courseDirs: listFromEnv(env.COURSE_STANDARDS_COURSES, [repoPath('data/courses')]),
    docRoots: listFromEnv(env.COURSE_STANDARDS_DOCS, [repoPath('examples')]),
    termbaseFile: env.COURSE_STANDARDS_TERMBASE?.trim() || repoPath('data/termbase/en-de.yaml'),
    // The rubric is the server's method and is versioned with the code: not configurable.
    rubricFile: repoPath('data/rubric/bloom.yaml'),
  };
}

/** Limits (design section 12). */
export const LIMITS = {
  documentBytes: 500_000,
  documentExtensions: ['.md', '.markdown', '.csv', '.yaml', '.yml', '.txt'],
  maxActivities: 2_000,
  excerptChars: 160,
} as const;
