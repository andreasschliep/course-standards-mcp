/**
 * The common shape every extractor produces, and the activity-type classification.
 *
 * An activity is one block of a facilitation plan, one row of a mapping document, one
 * passage of a course description, or one activity of an agenda YAML. Its level
 * ceiling is the highest Bloom level among its recognised activity types (design 5.3).
 */
import { levelIndex, type BloomLevel } from 'learning-objective-lint';
import type { ActivityType, Rubric } from '../data/rubric.ts';
import { cueMatches, tokens } from '../text.ts';

export type Via = 'id_reference' | 'table_row' | 'agenda' | 'keyword_match';

export interface Activity {
  /** Stable id within the document: "L41" (line), "R3" (row), "P2" (passage) or the agenda id. */
  id: string;
  title: string;
  /** "41-52" (lines), "row 3", or the agenda id. */
  location: string;
  minutes: number | null;
  phase: string | null;
  /** Heading plus body; used for cue and keyword matching and for the excerpt. */
  text: string;
  /** Text after the heading, for the excerpt. */
  body: string;
  objectiveIds: string[];
  unknownReferences: string[];
  via: Via;
  types: string[];
  ceiling: BloomLevel | null;
  isBreak: boolean;
  passive: boolean;
}

export interface Classification {
  types: string[];
  ceiling: BloomLevel | null;
  isBreak: boolean;
  /** Every recognised, non-ambiguous type is passive (lecture, demo, story, discussion). */
  passive: boolean;
}

export function classify(text: string, rubric: Rubric): Classification {
  const toks = tokens(text);
  const found: ActivityType[] = rubric.activityTypes.filter((t) =>
    t.cues.some((c) => cueMatches(c, toks)),
  );
  const relevant = found.filter((t) => !t.ignore);
  const typed = relevant.filter((t) => t.ceiling !== null);
  let ceiling: BloomLevel | null = null;
  for (const t of typed) {
    if (t.ceiling && (ceiling === null || levelIndex(t.ceiling) > levelIndex(ceiling)))
      ceiling = t.ceiling;
  }
  return {
    types: found.map((t) => t.id),
    ceiling,
    isBreak: found.length > 0 && relevant.length === 0,
    passive: typed.length > 0 && typed.every((t) => t.passive),
  };
}
