import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isFoundryIQConfigured, isAzureOpenAIConfigured } from './config.js';
import { worldStore } from './worldStore.js';
import { storyEngine } from './storyEngine.js';
import type { LoreKind } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

const app = express();
app.use(express.json({ limit: '256kb' }));

// Tiny request logger.
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) console.log(`${req.method} ${req.path}`);
  next();
});

/** Health + capability report (drives the "live vs offline" badge in the UI). */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    foundryIQ: isFoundryIQConfigured() ? 'live' : 'offline-fallback',
    narrator: isAzureOpenAIConfigured() ? 'azure-openai' : 'procedural-fallback',
    version: '1.0.0',
  });
});

/** List all worlds. */
app.get('/api/worlds', async (_req: Request, res: Response) => {
  res.json(await worldStore.list());
});

/** Get a single world bible. */
app.get('/api/worlds/:id', async (req: Request, res: Response) => {
  const world = await worldStore.get(req.params.id);
  if (!world) return res.status(404).json({ error: 'World not found' });
  res.json(world);
});

/** Create a new world. */
app.post('/api/worlds', async (req: Request, res: Response) => {
  const { name, premise, tone } = req.body ?? {};
  if (!isNonEmpty(name) || !isNonEmpty(premise)) {
    return res.status(400).json({ error: 'name and premise are required' });
  }
  const world = await worldStore.create({
    name: String(name).slice(0, 80),
    premise: String(premise).slice(0, 400),
    tone: isNonEmpty(tone) ? String(tone).slice(0, 80) : 'evocative, cinematic',
  });
  res.status(201).json(world);
});

/** Add a lore entry to a world bible. */
app.post('/api/worlds/:id/lore', async (req: Request, res: Response) => {
  const { kind, title, body, tags } = req.body ?? {};
  const kinds: LoreKind[] = ['character', 'location', 'faction', 'artifact', 'event', 'concept'];
  if (!kinds.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${kinds.join(', ')}` });
  }
  if (!isNonEmpty(title) || !isNonEmpty(body)) {
    return res.status(400).json({ error: 'title and body are required' });
  }
  const world = await worldStore.addLore(req.params.id, {
    kind,
    title: String(title).slice(0, 120),
    body: String(body).slice(0, 1200),
    tags: Array.isArray(tags) ? tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : [],
  });
  if (!world) return res.status(404).json({ error: 'World not found' });
  res.status(201).json(world);
});

/** Weave the next grounded, cited scene. */
app.post('/api/worlds/:id/weave', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const world = await worldStore.get(req.params.id);
    if (!world) return res.status(404).json({ error: 'World not found' });
    const prompt = isNonEmpty(req.body?.prompt) ? String(req.body.prompt).slice(0, 600) : '';
    const previously = isNonEmpty(req.body?.previously) ? String(req.body.previously).slice(0, 2000) : undefined;
    const scene = await storyEngine.weave(world, prompt, previously);
    res.json(scene);
  } catch (err) {
    next(err);
  }
});

// Static frontend.
app.use(express.static(PUBLIC_DIR));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Centralized error handler (incl. safety blocks).
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status ?? 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err?.message ?? 'Internal error', safety: Boolean(err?.safety) });
});

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

app.listen(config.port, () => {
  console.log(`\n  🪡  LoreWeaver running → http://localhost:${config.port}`);
  console.log(`      Foundry IQ : ${isFoundryIQConfigured() ? 'LIVE (agentic retrieval)' : 'offline grounding fallback'}`);
  console.log(`      Narrator   : ${isAzureOpenAIConfigured() ? 'Azure OpenAI' : 'procedural fallback'}\n`);
});
