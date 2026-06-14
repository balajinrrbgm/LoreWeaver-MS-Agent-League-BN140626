import { config, isFoundryIQConfigured } from './config.js';
import type { World, LoreEntry, Citation, GroundingResult } from '../shared/types.js';

/**
 * Foundry IQ grounding service.
 *
 * MICROSOFT IQ INTEGRATION (required by the challenge):
 * When a Foundry IQ knowledge base (Azure AI Search agentic retrieval) is
 * configured, `ground()` issues an agentic-retrieval request that decomposes the
 * narrative prompt into sub-queries, runs them in parallel, semantically reranks
 * the results, and returns grounded, *cited* passages.
 *
 * When no knowledge base is configured, we run an equivalent local "agentic
 * retrieval" pipeline over the in-memory world bible so the app — and the demo —
 * always works. The reasoning shape (plan -> search -> rank -> cite) is identical,
 * which keeps the UX and the cited-grounding guarantee intact offline.
 */
export class FoundryIQ {
  /** Plan sub-queries + retrieve grounded, cited context for a narrative beat. */
  async ground(world: World, prompt: string): Promise<GroundingResult> {
    const subQueries = this.planSubQueries(world, prompt);

    if (isFoundryIQConfigured()) {
      try {
        return await this.retrieveLive(world, prompt, subQueries);
      } catch (err) {
        // Live retrieval is best-effort; never break the story on a network hiccup.
        console.warn('[FoundryIQ] live retrieval failed, using local grounding:', (err as Error).message);
      }
    }
    return this.retrieveLocal(world, prompt, subQueries);
  }

  /**
   * Decompose the prompt into focused sub-queries — the "agentic" planning step.
   * We always include the world premise so opening scenes are grounded too.
   */
  private planSubQueries(world: World, prompt: string): string[] {
    const queries = new Set<string>();
    const clean = (prompt ?? '').trim();

    if (clean) queries.add(clean);

    // Entity-aware sub-queries: match canonical titles/tags named in the prompt.
    const haystack = clean.toLowerCase();
    for (const entry of world.lore) {
      const named =
        haystack.includes(entry.title.toLowerCase()) ||
        entry.tags.some((t) => haystack.includes(t.toLowerCase()));
      if (named) queries.add(`Who or what is ${entry.title}?`);
    }

    // Always anchor on the world's premise and current dramatic stakes.
    queries.add(`Core premise and tone of ${world.name}`);
    if (clean) queries.add(`What conflict or consequence follows from: ${clean}`);

    return [...queries].slice(0, 5);
  }

  /** Live Foundry IQ agentic retrieval via Azure AI Search knowledge base. */
  private async retrieveLive(
    world: World,
    prompt: string,
    subQueries: string[],
  ): Promise<GroundingResult> {
    const { endpoint, knowledgeBase, apiKey, apiVersion } = config.foundryIQ;
    const url = `${endpoint.replace(/\/$/, '')}/agents/${encodeURIComponent(
      knowledgeBase,
    )}/retrieve?api-version=${apiVersion}`;

    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `World: ${world.name}. Premise: ${world.premise}. ` +
                `Retrieve canon relevant to this story beat: ${prompt || 'opening scene'}`,
            },
          ],
        },
      ],
      // Hint the planner with our decomposed sub-queries.
      knowledgeSourceParams: subQueries.map((q) => ({ query: q })),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();

    // Normalize the references returned by agentic retrieval into citations.
    const refs: any[] = data?.references ?? data?.result?.references ?? [];
    const citations: Citation[] = refs.slice(0, 6).map((r, i) => ({
      ref: `L${i + 1}`,
      entryId: String(r.id ?? r.docKey ?? `ref-${i}`),
      title: String(r.title ?? r.sourceData?.title ?? 'Source'),
      kind: 'concept',
      snippet: truncate(String(r.content ?? r.sourceData?.content ?? ''), 240),
    }));

    const context =
      (typeof data?.response === 'string' && data.response) ||
      citations.map((c) => `[${c.ref}] ${c.title}: ${c.snippet}`).join('\n');

    return { live: true, query: prompt, subQueries, citations, context };
  }

  /** Local agentic-style retrieval over the world bible (offline fallback). */
  private retrieveLocal(
    world: World,
    prompt: string,
    subQueries: string[],
  ): GroundingResult {
    // Score every lore entry against the union of sub-queries (BM25-ish overlap).
    const terms = tokenize(subQueries.join(' ') + ' ' + world.premise);
    const scored = world.lore
      .map((entry) => ({ entry, score: scoreEntry(entry, terms, prompt) }))
      .sort((a, b) => b.score - a.score);

    // Always include at least the top entries so a scene is never ungrounded.
    const top = scored.filter((s) => s.score > 0).slice(0, 5);
    const chosen = top.length ? top : scored.slice(0, 3);

    const citations: Citation[] = chosen.map(({ entry }, i) => ({
      ref: `L${i + 1}`,
      entryId: entry.id,
      title: entry.title,
      kind: entry.kind,
      snippet: truncate(entry.body, 220),
    }));

    const context = chosen
      .map(({ entry }, i) => `[L${i + 1}] (${entry.kind}) ${entry.title}: ${entry.body}`)
      .join('\n');

    return { live: false, query: prompt, subQueries, citations, context };
  }
}

function scoreEntry(entry: LoreEntry, terms: string[], prompt: string): number {
  const text = `${entry.title} ${entry.body} ${entry.tags.join(' ')}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (term.length < 3) continue;
    if (text.includes(term)) score += 1;
    if (entry.tags.some((t) => t.toLowerCase().includes(term))) score += 1.5;
    if (entry.title.toLowerCase().includes(term)) score += 2;
  }
  // Direct mention in the prompt is a strong signal.
  const p = (prompt ?? '').toLowerCase();
  if (p && (p.includes(entry.title.toLowerCase()) || entry.tags.some((t) => p.includes(t.toLowerCase())))) {
    score += 4;
  }
  return score;
}

function tokenize(s: string): string[] {
  return Array.from(
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'what', 'who', 'are',
  'was', 'her', 'his', 'its', 'into', 'about', 'core', 'follows',
]);

export const foundryIQ = new FoundryIQ();
