import { randomUUID } from 'node:crypto';
import type {
  World,
  Scene,
  Choice,
  Citation,
  ReasoningStep,
  GroundingResult,
} from '../shared/types.js';
import { foundryIQ } from './foundryIQ.js';
import { narrate } from './narrator.js';
import { screenInput, screenOutput } from './safety.js';

/**
 * The LoreWeaver agentic story engine.
 *
 * Multi-step reasoning pipeline (surfaced to the UI as a trace):
 *   1. RETRIEVE — Foundry IQ agentic retrieval: plan sub-queries, search the
 *      world bible, rerank, and return grounded + cited canon.
 *   2. PLAN     — turn grounded facts into a scene plan (focus, stakes, beat).
 *   3. NARRATE  — write prose that *only* asserts world facts that are cited.
 *   4. BRANCH   — derive meaningful choices from the grounded entities.
 */
export class StoryEngine {
  async weave(world: World, prompt: string, previously?: string): Promise<Scene> {
    const safe = screenInput(prompt ?? '');
    if (!safe.ok) {
      throw Object.assign(new Error(safe.reason), { status: 400, safety: true });
    }

    const trace: ReasoningStep[] = [];

    // ---- Stage 1: RETRIEVE (Foundry IQ) -----------------------------------
    const grounding = await foundryIQ.ground(world, prompt);
    trace.push({
      stage: 'retrieve',
      label: grounding.live ? 'Foundry IQ agentic retrieval (live)' : 'Agentic retrieval (local grounding)',
      detail:
        `Planned ${grounding.subQueries.length} sub-queries → ` +
        `${grounding.citations.length} cited sources: ` +
        grounding.citations.map((c) => `${c.ref} ${c.title}`).join(', '),
    });

    // ---- Stage 2: PLAN ----------------------------------------------------
    const plan = this.planScene(world, prompt, grounding);
    trace.push({ stage: 'plan', label: 'Scene plan', detail: plan.summary });

    // ---- Stage 3: NARRATE -------------------------------------------------
    let prose = await this.narrateScene(world, prompt, grounding, plan, previously);
    const outSafe = screenOutput(prose);
    if (!outSafe.ok) prose = `*(${outSafe.reason})*`;
    trace.push({
      stage: 'narrate',
      label: prose.includes('[L') ? 'Grounded narration' : 'Narration',
      detail: `${countWords(prose)} words, ${(prose.match(/\[L\d+\]/g) ?? []).length} inline citations.`,
    });

    // ---- Stage 4: BRANCH --------------------------------------------------
    const choices = this.deriveChoices(grounding, plan);
    trace.push({
      stage: 'branch',
      label: 'Branching choices',
      detail: choices.map((c) => `• ${c.label}`).join('  '),
    });

    return {
      id: randomUUID(),
      worldId: world.id,
      title: plan.title,
      prose,
      choices,
      citations: grounding.citations,
      grounding: { live: grounding.live, subQueries: grounding.subQueries },
      trace,
      createdAt: new Date().toISOString(),
    };
  }

  // --- Stage 2 implementation -------------------------------------------------
  private planScene(world: World, prompt: string, g: GroundingResult) {
    const lead = g.citations[0];
    const opening = !prompt?.trim();
    const focus = lead?.title ?? world.name;
    const title = opening
      ? `An Opening in ${world.name}`
      : titleCase(truncateWords(prompt, 6));
    const summary = opening
      ? `Open the story by grounding the reader in ${focus}, establishing tone "${world.tone}", and seeding the central tension.`
      : `Advance the story toward "${truncateWords(prompt, 10)}", grounded in ${g.citations
          .map((c) => c.title)
          .slice(0, 3)
          .join(', ')}. Honor established canon; do not contradict it.`;
    return { title, focus, opening, summary };
  }

  // --- Stage 3 implementation -------------------------------------------------
  private async narrateScene(
    world: World,
    prompt: string,
    g: GroundingResult,
    plan: { opening: boolean; focus: string },
    previously?: string,
  ): Promise<string> {
    const system =
      `You are LoreWeaver, a master narrator of grounded interactive fiction. ` +
      `Write in a ${world.tone} tone for the world "${world.name}" (${world.premise}). ` +
      `CRITICAL RULES: (1) Only state world facts that appear in the GROUNDED CANON. ` +
      `(2) When you use a fact, append its citation marker like [L1] right after the sentence. ` +
      `(3) Never invent names, places, or history that contradict the canon. ` +
      `(4) Write 2-3 vivid paragraphs and end on a moment of choice. Do not list the choices yourself.`;

    const user =
      `GROUNDED CANON:\n${g.context}\n\n` +
      (previously ? `PREVIOUSLY:\n${previously}\n\n` : '') +
      (plan.opening
        ? `Write the OPENING scene, centered on ${plan.focus}.`
        : `The reader chose: "${prompt}". Continue the story from there.`);

    const llm = await narrate({ system, user, temperature: 0.85 });
    if (llm) return llm;

    // Deterministic, grounded fallback narrator (no API key required).
    return this.proceduralNarrator(world, prompt, g, plan, previously);
  }

  /**
   * Procedural narrator: weaves cited canon into coherent, tone-aware prose.
   * Guarantees the offline demo is grounded and never empty.
   */
  private proceduralNarrator(
    world: World,
    prompt: string,
    g: GroundingResult,
    plan: { opening: boolean; focus: string },
    previously?: string,
  ): string {
    const c = g.citations;
    const by = (kinds: string[]) => c.filter((x) => kinds.includes(x.kind));
    const loc = by(['location'])[0] ?? c[0];
    const who = by(['character'])[0];
    const force = by(['faction', 'artifact', 'event'])[0];
    const concept = by(['concept'])[0];

    const phrase = (cit?: Citation) =>
      cit ? `${firstClause(cit.snippet)} [${cit.ref}]` : '';

    const paras: string[] = [];

    if (plan.opening) {
      paras.push(
        cap(
          `${loc ? `${loc.title} ` : 'The world '}waits at the edge of the story. ` +
            `${phrase(loc)} It is here that ${world.name} reveals its quiet ache — ${world.premise.toLowerCase()}`,
        ),
      );
      if (who) {
        paras.push(
          cap(
            `${who.title.split(',')[0]} moves through it like someone who belongs and grieves in equal measure. ` +
              `${phrase(who)} ${concept ? `The old powers stir as well — ${firstClause(concept.snippet).toLowerCase()} [${concept.ref}].` : ''}`,
          ),
        );
      }
      if (force) {
        paras.push(
          cap(
            `But nothing here is still for long. ${phrase(force)} ` +
              `The question is no longer whether the story will move, but who will be brave — or foolish — enough to move first.`,
          ),
        );
      }
    } else {
      if (previously) {
        paras.push(cap(`The choice settles like silt. ${truncateWords(previously.replace(/\[L\d+\]/g, ''), 18)}…`));
      }
      paras.push(
        cap(
          `${decorateChoice(prompt)} ${loc ? `Around ${shortTitle(loc.title)}, the world answers.` : ''} ${phrase(loc)}`,
        ),
      );
      if (who) {
        paras.push(
          cap(`${shortTitle(who.title)} does not flinch. ${phrase(who)} ${force ? `Yet ${shortTitle(force.title)} casts a longer shadow now — ${firstClause(force.snippet).toLowerCase()} [${force.ref}].` : ''}`),
        );
      } else if (force) {
        paras.push(cap(`${phrase(force)} What happens next will not be undone easily.`));
      }
      paras.push(
        cap(
          `${concept ? `${firstClause(concept.snippet)} [${concept.ref}], and ` : ''}the path forks. ` +
            `Three ways open before you, each grounded in what this world already knows of itself.`,
        ),
      );
    }

    return paras.filter(Boolean).join('\n\n');
  }

  // --- Stage 4 implementation -------------------------------------------------
  private deriveChoices(g: GroundingResult, plan: { focus: string }): Choice[] {
    const c = g.citations;
    const pick = (kinds: string[]) => c.find((x) => kinds.includes(x.kind));
    const character = pick(['character']);
    const force = pick(['faction', 'artifact', 'event']);
    const place = pick(['location']);
    const concept = pick(['concept']);

    const candidates: Array<Choice | null> = [
      character
        ? mk(`Seek out ${shortTitle(character.title)}`, `Pursue the thread of ${character.title}`)
        : null,
      force
        ? mk(`Confront ${shortTitle(force.title)}`, `Press into the conflict around ${force.title}`)
        : null,
      place
        ? mk(`Descend deeper into ${shortTitle(place.title)}`, `Explore ${place.title} further`)
        : null,
      concept
        ? mk(`Draw on ${shortTitle(concept.title)}`, `Invoke ${concept.title}`)
        : null,
    ];

    const choices = candidates.filter(Boolean).slice(0, 3) as Choice[];
    // Always offer at least one open-ended path.
    if (choices.length < 3) {
      choices.push(mk('Forge your own path', 'Improvise an unexpected action'));
    }
    return choices.slice(0, 3);
  }
}

// --- helpers -----------------------------------------------------------------
function mk(label: string, intent: string): Choice {
  return { id: randomUUID().slice(0, 8), label, intent };
}
function shortTitle(t: string): string {
  return t.split(',')[0];
}
function firstClause(s: string): string {
  const m = s.split(/(?<=[.!?])\s/)[0] ?? s;
  return m.replace(/[…]+$/, '').trim();
}
function decorateChoice(prompt: string): string {
  const p = prompt.trim();
  if (!p) return 'The story breathes in.';
  return `You chose: ${p}.`;
}
function cap(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
function truncateWords(s: string, n: number): string {
  const words = (s ?? '').trim().split(/\s+/);
  return words.length <= n ? s.trim() : words.slice(0, n).join(' ');
}
function countWords(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

export const storyEngine = new StoryEngine();
