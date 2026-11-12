/**
 * Typed boundary to learning-objective-lint (CommonJS, no own types).
 * Declares only the part of the library this server uses (design D5).
 */
declare module 'learning-objective-lint' {
  export type BloomLevel = 'Remember' | 'Understand' | 'Apply' | 'Analyse' | 'Evaluate' | 'Create';

  export const BLOOM_LEVELS: readonly BloomLevel[];

  export class InputError extends Error {
    problems: string[];
  }

  export interface Objective {
    id: string;
    level: BloomLevel | null;
    text: string;
    moduleId: string;
    moduleTitle: string;
  }

  export interface ObjectivesDoc {
    metadata: Record<string, unknown>;
    objectives: Objective[];
  }

  export interface AgendaActivity {
    id: string;
    title: string;
    minutes: number | null;
    description: string;
    objectives: Array<{ id: string; level: BloomLevel }>;
  }

  export interface AgendaDoc {
    metadata: Record<string, unknown>;
    activities: AgendaActivity[];
  }

  export function parseObjectives(doc: unknown, source?: string): ObjectivesDoc;
  export function parseAgenda(doc: unknown, source?: string): AgendaDoc;
  export function normaliseLevel(level: unknown): BloomLevel | null;
  export function levelIndex(level: string | null | undefined): number;

  export interface LintRuleResult {
    ruleId: string;
    status: 'pass' | 'warn' | 'fail';
    message?: string;
    evidence?: string;
  }

  export function lintObjective(lo: { id: string; level: string | null; text: string }): {
    lo: unknown;
    results: LintRuleResult[];
    worstStatus: 'pass' | 'warn' | 'fail';
  };

  export function loadVerbs(): {
    byLevel: Record<BloomLevel, string[]>;
    vague: string[];
    aspirational: string[];
    activity: string[];
    ambiguous: string[];
  };

  export interface CoverageRow {
    lo: Objective;
    links: Array<{ activityId: string; activityTitle: string; level: BloomLevel }>;
    status: 'covered' | 'partial' | 'missing';
    note: string;
    overCovered: boolean;
  }

  export interface CoverageResult {
    rows: CoverageRow[];
    counts: { covered: number; partial: number; missing: number; overCovered: number };
    overThreshold: number;
    unknownRefs: Array<{ activityId: string; objectiveId: string }>;
    activitiesWithoutObjectives: string[];
    distribution: {
      target: Record<BloomLevel, number>;
      practised: Record<BloomLevel, number>;
      unspecified: number;
      profileCheck: null | {
        audience: string;
        known: boolean;
        description?: string;
        focus?: BloomLevel[];
        minShare?: number;
        share?: number;
        ok?: boolean;
      };
    };
  }

  export function computeCoverage(
    objectivesDoc: ObjectivesDoc,
    agendaDoc: AgendaDoc,
    options?: { overThreshold?: number },
  ): CoverageResult;
}
