import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Load .env sederhana (tanpa dependency dotenv). Tidak menimpa env yang sudah ada. */
export async function loadEnv(envPath = resolve(projectRoot, '.env')) {
  try {
    const text = await readFile(envPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
    if (!process.env.NINEROUTER_VISION_MODEL && process.env.NINEROUTER_MODEL) {
      process.env.NINEROUTER_VISION_MODEL = process.env.NINEROUTER_MODEL;
    }
  } catch {
    /* .env opsional jika env sudah diset di shell */
  }
  if (!process.env.NINEROUTER_VISION_MODEL && process.env.NINEROUTER_MODEL) {
    process.env.NINEROUTER_VISION_MODEL = process.env.NINEROUTER_MODEL;
  }
}
