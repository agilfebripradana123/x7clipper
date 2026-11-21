/**
 * Cleanup file runtime lama: storage/tmp dan storage/raw-clips (> 24 jam default).
 * storage/exports (hasil render) dan transcripts tidak pernah disentuh.
 *
 * Pakai: node scripts/cleanup.js [--dry-run]
 * Jadwalkan via cron / Windows Task Scheduler.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from '../src/env.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const TARGETS = [
  process.env.STORAGE_TMP || './storage/tmp',
  process.env.STORAGE_RAW_CLIPS || './storage/raw-clips',
];

export function maxAgeMs(env = process.env) {
  const hours = Number.parseFloat(env.CLEANUP_MAX_AGE_HOURS ?? '24');
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3_600_000;
}

/** Hapus file tua di setiap direktori target. Direktori hilang diabaikan. */
export async function cleanupStorage({
  dirs = TARGETS,
  ageMs = maxAgeMs(),
  now = Date.now(),
  dryRun = false,
  readDir = readdir,
  fileStat = stat,
  remove = unlink,
  log = () => {},
  root = projectRoot,
} = {}) {
  const removed = [];
  const kept = [];
  const failed = [];

  for (const dir of dirs) {
    const absolute = resolve(root, dir);
    let entries;
    try {
      entries = await readDir(absolute, { withFileTypes: true });
    } catch {
      log(`lewati ${dir} (tidak ada)`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || entry.name === '.gitkeep') continue;

      const path = join(absolute, entry.name);
      try {
        const info = await fileStat(path);
        if (now - info.mtimeMs < ageMs) {
          kept.push(path);
          continue;
        }
        if (!dryRun) await remove(path);
        removed.push({ path, sizeBytes: info.size, modifiedMs: info.mtimeMs });
        log(`${dryRun ? 'akan hapus' : 'hapus'} ${path}`);
      } catch (error) {
        failed.push({ path, error: error.message });
        log(`gagal ${path}: ${error.message}`);
      }
    }
  }

  return { removed, kept, failed };
}

async function main() {
  await loadEnv();
  const dryRun = process.argv.includes('--dry-run');
  const ageMs = maxAgeMs();
  const log = (message) => console.log(`[cleanup] ${message}`);

  const { removed, kept, failed } = await cleanupStorage({ ageMs, dryRun, log });
  log(`selesai: ${removed.length} dihapus, ${kept.length} dipertahankan, ${failed.length} gagal`);
  if (!dryRun) {
    log(`ambang: ${Math.round(ageMs / 3_600_000)} jam`);
  }
  if (failed.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
