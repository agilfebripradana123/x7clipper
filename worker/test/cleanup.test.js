import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupStorage, maxAgeMs } from '../scripts/cleanup.js';

const HOUR = 3_600_000;

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'x7-cleanup-'));
  await mkdir(join(root, 'tmp'), { recursive: true });
  await mkdir(join(root, 'raw-clips'), { recursive: true });

  const old = join(root, 'tmp', 'temp-lama.mp4');
  const fresh = join(root, 'tmp', 'temp-baru.mp4');
  const keep = join(root, 'tmp', '.gitkeep');
  const oldClip = join(root, 'raw-clips', 'clip-9.mp4');

  for (const path of [old, fresh, keep, oldClip]) await writeFile(path, 'x');

  const now = Date.now();
  await utimes(old, new Date(now - 48 * HOUR), new Date(now - 48 * HOUR));
  await utimes(oldClip, new Date(now - 25 * HOUR), new Date(now - 25 * HOUR));
  await utimes(fresh, new Date(now - 1 * HOUR), new Date(now - 1 * HOUR));

  return { root, now, old, fresh, keep, oldClip };
}

test('cleanupStorage hapus file > 24 jam, pertahankan file baru dan .gitkeep', async () => {
  const fx = await makeFixture();
  try {
    const result = await cleanupStorage({
      root: fx.root,
      dirs: ['./tmp', './raw-clips'],
      ageMs: 24 * HOUR,
      now: fx.now,
    });

    assert.equal(result.removed.length, 2);
    assert.equal(result.failed.length, 0);
    // temp-baru.mp4 dipertahankan; .gitkeep di-skip sebelum dievaluasi
    assert.equal(result.kept.length, 1);

    const tmpEntries = await readdir(join(fx.root, 'tmp'));
    assert.deepEqual(tmpEntries.sort(), ['.gitkeep', 'temp-baru.mp4']);
    assert.deepEqual(await readdir(join(fx.root, 'raw-clips')), []);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('cleanupStorage --dry-run tidak menghapus file', async () => {
  const fx = await makeFixture();
  try {
    const result = await cleanupStorage({
      root: fx.root,
      dirs: ['./tmp'],
      ageMs: 24 * HOUR,
      now: fx.now,
      dryRun: true,
    });

    assert.equal(result.removed.length, 1);
    const entries = await readdir(join(fx.root, 'tmp'));
    assert.ok(entries.includes('temp-lama.mp4'));
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('cleanupStorage mengabaikan direktori yang tidak ada', async () => {
  const root = await mkdtemp(join(tmpdir(), 'x7-cleanup-'));
  try {
    const result = await cleanupStorage({ root, dirs: ['./tidak-ada'], ageMs: 24 * HOUR });
    assert.deepEqual(result, { removed: [], kept: [], failed: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanupStorage mencatat kegagalan hapus tanpa throw', async () => {
  const fx = await makeFixture();
  try {
    const result = await cleanupStorage({
      root: fx.root,
      dirs: ['./tmp'],
      ageMs: 24 * HOUR,
      now: fx.now,
      remove: async () => { throw new Error('akses ditolak'); },
    });

    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].error, /akses ditolak/);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('maxAgeMs default 24 jam dan menolak nilai tidak valid', () => {
  assert.equal(maxAgeMs({}), 24 * HOUR);
  assert.equal(maxAgeMs({ CLEANUP_MAX_AGE_HOURS: '12' }), 12 * HOUR);
  assert.equal(maxAgeMs({ CLEANUP_MAX_AGE_HOURS: '0' }), 24 * HOUR);
  assert.equal(maxAgeMs({ CLEANUP_MAX_AGE_HOURS: 'abc' }), 24 * HOUR);
});
