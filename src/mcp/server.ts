/**
 * LoreWeaver MCP server.
 *
 * Exposes the grounded storytelling engine as tools that GitHub Copilot (in
 * VS Code or the Copilot CLI) can call during chat. This lets a developer weave
 * cited, canon-consistent fiction without leaving their editor — the same
 * Foundry IQ agentic retrieval pipeline that powers the web studio.
 *
 * Connect it via .vscode/mcp.json (see repo root) and ask Copilot things like:
 *   "Weave the opening scene for the aethelgard world."
 *   "Ground the lore about the Dawn Vault and cite sources."
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { worldStore } from '../server/worldStore.js';
import { storyEngine } from '../server/storyEngine.js';
import { foundryIQ } from '../server/foundryIQ.js';
import { looksLikeInjection } from '../server/safety.js';
import type { LoreKind } from '../shared/types.js';

const server = new McpServer({ name: 'loreweaver', version: '1.0.0' });

const loreKinds = ['character', 'location', 'faction', 'artifact', 'event', 'concept'] as const;

server.registerTool(
  'list_worlds',
  {
    title: 'List worlds',
    description: 'List all available LoreWeaver world bibles (id, name, premise, lore count).',
    inputSchema: {},
  },
  async () => {
    const worlds = await worldStore.list();
    const text = worlds
      .map((w) => `• ${w.id} — ${w.name} (${w.lore.length} lore entries)\n    ${w.premise}`)
      .join('\n');
    return { content: [{ type: 'text', text: text || 'No worlds yet. Create one with create_world.' }] };
  },
);

server.registerTool(
  'get_world',
  {
    title: 'Get world bible',
    description: 'Return the full canon (all lore entries) for a world by id.',
    inputSchema: { worldId: z.string().describe('The world id, e.g. "aethelgard".') },
  },
  async ({ worldId }) => {
    const world = await worldStore.get(worldId);
    if (!world) return err(`World "${worldId}" not found.`);
    const text =
      `# ${world.name}\n${world.premise}\nTone: ${world.tone}\n\n` +
      world.lore.map((e) => `## [${e.kind}] ${e.title}\n${e.body}`).join('\n\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'ground_lore',
  {
    title: 'Ground lore (Foundry IQ)',
    description:
      'Run Foundry IQ agentic retrieval over a world bible: plan sub-queries, retrieve, and return grounded passages WITH citations. Use this to fact-check or gather canon before writing.',
    inputSchema: {
      worldId: z.string().describe('The world id.'),
      query: z.string().describe('What to ground, e.g. "the history of the Dawn Vault".'),
    },
  },
  async ({ worldId, query }) => {
    const world = await worldStore.get(worldId);
    if (!world) return err(`World "${worldId}" not found.`);
    if (looksLikeInjection(query)) return err('Query rejected by safety screen.');
    const g = await foundryIQ.ground(world, query);
    const text =
      `Retrieval: ${g.live ? 'Foundry IQ (live)' : 'offline grounding'}\n` +
      `Sub-queries: ${g.subQueries.join(' | ')}\n\nCited canon:\n` +
      g.citations.map((c) => `[${c.ref}] ${c.title} (${c.kind})\n  ${c.snippet}`).join('\n\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'weave_scene',
  {
    title: 'Weave a grounded scene',
    description:
      'Generate the next interactive-fiction scene grounded in a world bible. Returns cited prose, a 4-stage reasoning trace, and branching choices. Leave prompt empty for an opening scene.',
    inputSchema: {
      worldId: z.string().describe('The world id.'),
      prompt: z.string().optional().describe('Reader action or chosen branch. Empty = opening scene.'),
      previously: z.string().optional().describe('Prior scene prose for continuity.'),
    },
  },
  async ({ worldId, prompt, previously }) => {
    const world = await worldStore.get(worldId);
    if (!world) return err(`World "${worldId}" not found.`);
    const scene = await storyEngine.weave(world, prompt ?? '', previously);
    const text =
      `# ${scene.title}  ${scene.grounding.live ? '(Foundry IQ live)' : '(grounded offline)'}\n\n` +
      `${scene.prose}\n\n` +
      `Choices:\n${scene.choices.map((c, i) => `  ${i + 1}. ${c.label}`).join('\n')}\n\n` +
      `Citations:\n${scene.citations.map((c) => `  [${c.ref}] ${c.title}`).join('\n')}\n\n` +
      `Reasoning trace:\n${scene.trace.map((t) => `  ${t.stage}: ${t.label}`).join('\n')}`;
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'create_world',
  {
    title: 'Create a world',
    description: 'Create a new world bible with a name, premise, and tone.',
    inputSchema: {
      name: z.string(),
      premise: z.string(),
      tone: z.string().optional(),
    },
  },
  async ({ name, premise, tone }) => {
    const world = await worldStore.create({ name, premise, tone: tone ?? 'evocative, cinematic' });
    return { content: [{ type: 'text', text: `Created world "${world.name}" (id: ${world.id}).` }] };
  },
);

server.registerTool(
  'add_lore',
  {
    title: 'Add lore to canon',
    description: 'Add a grounded lore entry (character/location/faction/artifact/event/concept) to a world. This text becomes citable canon.',
    inputSchema: {
      worldId: z.string(),
      kind: z.enum(loreKinds),
      title: z.string(),
      body: z.string(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ worldId, kind, title, body, tags }) => {
    const world = await worldStore.addLore(worldId, { kind: kind as LoreKind, title, body, tags: tags ?? [] });
    if (!world) return err(`World "${worldId}" not found.`);
    return { content: [{ type: 'text', text: `Added [${kind}] "${title}" to ${world.name}. Canon now has ${world.lore.length} entries.` }] };
  },
);

function err(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[loreweaver-mcp] ready on stdio');
