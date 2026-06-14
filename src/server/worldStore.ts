import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { World, LoreEntry } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SEED_DIR = path.join(ROOT, 'data', 'seed');
const WORLDS_DIR = path.join(ROOT, 'data', 'worlds');

/**
 * File-backed store for user worlds. Simple, dependency-free persistence —
 * each world is a JSON document. Seed worlds are copied in on first run.
 */
class WorldStore {
  private cache = new Map<string, World>();
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await fs.mkdir(WORLDS_DIR, { recursive: true });

    // Load existing user worlds.
    const files = await safeReadDir(WORLDS_DIR);
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const world = await readJson<World>(path.join(WORLDS_DIR, file));
      if (world?.id) this.cache.set(world.id, world);
    }

    // Seed defaults if missing (so the app is never empty on first run).
    const seeds = await safeReadDir(SEED_DIR);
    for (const file of seeds.filter((f) => f.endsWith('.json'))) {
      const seed = await readJson<World>(path.join(SEED_DIR, file));
      if (seed?.id && !this.cache.has(seed.id)) {
        this.cache.set(seed.id, seed);
        await this.persist(seed);
      }
    }
  }

  async list(): Promise<World[]> {
    await this.ready;
    return [...this.cache.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  async get(id: string): Promise<World | undefined> {
    await this.ready;
    return this.cache.get(id);
  }

  async create(input: {
    name: string;
    premise: string;
    tone: string;
    lore?: LoreEntry[];
  }): Promise<World> {
    await this.ready;
    const now = new Date().toISOString();
    const world: World = {
      id: slugify(input.name) || `world-${Date.now()}`,
      name: input.name,
      premise: input.premise,
      tone: input.tone,
      lore: input.lore ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.cache.set(world.id, world);
    await this.persist(world);
    return world;
  }

  async addLore(
    worldId: string,
    entry: Omit<LoreEntry, 'id'> & { id?: string },
  ): Promise<World | undefined> {
    await this.ready;
    const world = this.cache.get(worldId);
    if (!world) return undefined;
    const id = entry.id || `${entry.kind}-${slugify(entry.title)}-${Date.now().toString(36)}`;
    world.lore.push({
      id,
      kind: entry.kind,
      title: entry.title,
      body: entry.body,
      tags: entry.tags ?? [],
    });
    world.updatedAt = new Date().toISOString();
    await this.persist(world);
    return world;
  }

  private async persist(world: World): Promise<void> {
    const file = path.join(WORLDS_DIR, `${world.id}.json`);
    await fs.writeFile(file, JSON.stringify(world, null, 2), 'utf8');
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export const worldStore = new WorldStore();
