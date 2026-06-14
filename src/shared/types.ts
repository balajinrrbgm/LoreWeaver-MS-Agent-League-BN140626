/**
 * Shared domain types for LoreWeaver.
 *
 * A "World" is the user's world bible — a collection of grounded lore entries
 * (locations, characters, factions, artifacts, events). The story engine grounds
 * every generated scene in these entries and cites them, so narratives stay
 * consistent with the canon the user authored.
 */

export type LoreKind =
  | 'character'
  | 'location'
  | 'faction'
  | 'artifact'
  | 'event'
  | 'concept';

/** A single grounded knowledge entry — the unit Foundry IQ retrieves and cites. */
export interface LoreEntry {
  id: string;
  kind: LoreKind;
  title: string;
  /** Free-form canonical text. This is what gets retrieved + cited. */
  body: string;
  /** Tags help the retriever and keep relationships explicit. */
  tags: string[];
}

export interface World {
  id: string;
  name: string;
  /** One-line premise / tone used to steer narration. */
  premise: string;
  /** Narrative tone, e.g. "epic, hopeful", "noir, tense". */
  tone: string;
  lore: LoreEntry[];
  createdAt: string;
  updatedAt: string;
}

/** A citation linking a sentence/beat back to the grounded lore that supports it. */
export interface Citation {
  ref: string; // e.g. "L1"
  entryId: string;
  title: string;
  kind: LoreKind;
  snippet: string;
}

/** One branch the reader can choose to continue the story. */
export interface Choice {
  id: string;
  label: string;
  /** Short hint of where this branch leads (used to ground the next scene). */
  intent: string;
}

/** The retrieval step's output: grounded facts + provenance. */
export interface GroundingResult {
  /** Whether live Foundry IQ was used (true) or the offline fallback (false). */
  live: boolean;
  query: string;
  /** Sub-queries the agentic retriever planned (multi-step reasoning trace). */
  subQueries: string[];
  citations: Citation[];
  /** Concatenated grounded context handed to the narrator. */
  context: string;
}

/** A fully woven scene returned to the client. */
export interface Scene {
  id: string;
  worldId: string;
  title: string;
  prose: string;
  choices: Choice[];
  citations: Citation[];
  grounding: {
    live: boolean;
    subQueries: string[];
  };
  /** The 4-stage reasoning trace, surfaced for transparency in the UI. */
  trace: ReasoningStep[];
  createdAt: string;
}

export interface ReasoningStep {
  stage: 'retrieve' | 'plan' | 'narrate' | 'branch';
  label: string;
  detail: string;
}

export interface WeaveRequest {
  worldId: string;
  /** Reader's prompt / chosen branch intent. Empty => opening scene. */
  prompt?: string;
  /** Prior prose for continuity (last scene), optional. */
  previously?: string;
}
