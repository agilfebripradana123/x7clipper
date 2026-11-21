import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject, prepareClip, handleJob, MAX_ATTEMPTS, JOB_LIST } from '../src/consumer.js';
import { CLIP_INSERT_SQL, jsonOrNull, toClipParams } from '../src/db.js';

const VTT = `WEBVTT

00:00:00.000 --> 00:00:08.000
Halo semua selamat datang di podcast ini.

00:00:08.000 --> 00:00:16.000
Hari ini kita bahas topik menarik sekali.

00:00:16.000 --> 00:00:26.000
Mari kita mulai pembahasannya dari awal.
`;

const PROJECT = { id: 7, youtube_url: 'https://youtu.be/dQw4w9WgXcQ' };

function fakeDb(project = PROJECT) {
  const calls = [];
  return {
    calls,
    db: {
      getProject: async (id) => { calls.push(['getProject', id]); return project; },
      markExtracting: async (...args) => calls.push(['markExtracting', ...args]),
      saveTranscript: async (...args) => calls.push(['saveTranscript', ...args]),
      markAnalyzing: async (...args) => calls.push(['markAnalyzing', ...args]),
      markQueued: async (...args) => calls.push(['markQueued', ...args]),
      failProject: async (...args) => calls.push(['failProject', ...args]),
      saveClipsAndReady: async (...args) => calls.push(['saveClipsAndReady', ...args]),
    },
  };
}

const deps = (db, overrides = {}) => ({
  db,
  log: () => {},
  requeue: async () => {},
  getMetadata: async () => ({ title: 'Podcast Uji', duration_sec: 600 }),
  getTranscript: async () => ({ content: VTT }),
  selectClips: async () => ({
    clips: [{
      title: 'Momen Pembuka',
      start_segment_id: 'S1',
      end_segment_id: 'S3',
      viral_score: 88,
      hook_type: 'story',
      reason: 'Hook kuat',
      suggested_caption: 'Tonton sampai habis',
    }],
  }),
  ...overrides,
});

test('analyzeProject happy path: status berurutan dan klip tersimpan', async () => {
  const { db, calls } = fakeDb();
  const result = await analyzeProject({ type: 'analyze_project', project_id: 7, attempt: 1 }, deps(db));

  assert.equal(result.clips, 1);
  assert.deepEqual(calls.map(([name]) => name), [
    'getProject', 'markExtracting', 'saveTranscript', 'markAnalyzing', 'saveClipsAndReady',
  ]);

  const savedClips = calls.at(-1)[2];
  assert.equal(savedClips.length, 1);
  assert.equal(savedClips[0].title, 'Momen Pembuka');
  assert.equal(savedClips[0].start_sec, 0); // padding -0.35 di-clamp ke 0
  assert.equal(savedClips[0].end_sec, 26.5); // +0.50 padding
});

test('analyzeProject melewati project yang tidak ada', async () => {
  const { db, calls } = fakeDb(null);
  const result = await analyzeProject({ type: 'analyze_project', project_id: 99 }, deps(db));

  assert.equal(result.skipped, true);
  assert.deepEqual(calls, [['getProject', 99]]);
});

test('analyzeProject requeue saat gagal dan attempt masih tersisa', async () => {
  const { db, calls } = fakeDb();
  const requeued = [];
  const result = await analyzeProject(
    { type: 'analyze_project', project_id: 7, attempt: 1 },
    deps(db, {
      getMetadata: async () => { throw new Error('yt-dlp down'); },
      requeue: async (job) => requeued.push(job),
    }),
  );

  assert.equal(result.retried, true);
  assert.deepEqual(requeued, [{ type: 'analyze_project', project_id: 7, attempt: 2 }]);
  assert.ok(calls.some(([name]) => name === 'markQueued'));
  assert.ok(!calls.some(([name]) => name === 'failProject'));
});

test('analyzeProject menandai failed saat attempt habis', async () => {
  const { db, calls } = fakeDb();
  const result = await analyzeProject(
    { type: 'analyze_project', project_id: 7, attempt: MAX_ATTEMPTS },
    deps(db, { getMetadata: async () => { throw new Error('blocked'); } }),
  );

  assert.equal(result.failed, true);
  const failed = calls.find(([name]) => name === 'failProject');
  assert.deepEqual(failed, ['failProject', 7, 'blocked']);
});

test('handleJob membuang tipe job tak dikenal', async () => {
  const result = await handleJob({ type: 'unknown' }, { log: () => {} });
  assert.equal(result.ignored, true);
  assert.equal(JOB_LIST, 'x7:jobs');
});

const CLIP = { id: 5, project_id: 7, start_sec: 10, end_sec: 40, raw_clip_path: null, prepare_status: 'pending' };

function fakeClipDb({ clip = CLIP, project = PROJECT, segmentMap = { S1: { start: 0, end: 8, text: 'Halo' } } } = {}) {
  const calls = [];
  return {
    calls,
    db: {
      getClip: async (id) => { calls.push(['getClip', id]); return clip; },
      getProject: async (id) => { calls.push(['getProject', id]); return project; },
      getProjectTranscript: async (id) => { calls.push(['getProjectTranscript', id]); return segmentMap; },
      markClipPreparing: async (...args) => calls.push(['markClipPreparing', ...args]),
      markClipReady: async (...args) => calls.push(['markClipReady', ...args]),
      markClipFailed: async (...args) => calls.push(['markClipFailed', ...args]),
    },
  };
}

const prepareDeps = (db, overrides = {}) => ({
  db,
  log: () => {},
  clipSegment: async () => ({ clipPath: 'D:\\storage\\raw-clips\\clip-5.mp4', durationSec: 30, sizeBytes: 1234 }),
  shiftSubtitles: () => [{ start: 0, end: 30, text: 'Halo' }],
  fileExists: async () => false,
  ...overrides,
});

test('prepareClip melewati klip yang tidak ada', async () => {
  const { db, calls } = fakeClipDb({ clip: null });
  const result = await prepareClip({ type: 'prepare_clip', clip_id: 99 }, prepareDeps(db));

  assert.equal(result.skipped, true);
  assert.deepEqual(calls, [['getClip', 99]]);
});

test('prepareClip sukses: clipId deterministik, status ready, subtitle tersimpan', async () => {
  const { db, calls } = fakeClipDb();
  const clipArgs = [];
  const result = await prepareClip(
    { type: 'prepare_clip', clip_id: 5 },
    prepareDeps(db, {
      clipSegment: async (...args) => {
        clipArgs.push(args);
        return { clipPath: 'D:\\storage\\raw-clips\\clip-5.mp4', durationSec: 30, sizeBytes: 1234 };
      },
    }),
  );

  assert.equal(clipArgs.length, 1);
  assert.equal(clipArgs[0][0], PROJECT.youtube_url);
  assert.equal(clipArgs[0][1], 10);
  assert.equal(clipArgs[0][2], 40);
  assert.equal(clipArgs[0][3].clipId, 'clip-5');

  const ready = calls.find(([name]) => name === 'markClipReady');
  assert.deepEqual(ready, [
    'markClipReady',
    5,
    { rawClipPath: 'D:\\storage\\raw-clips\\clip-5.mp4', subtitles: [{ start: 0, end: 30, text: 'Halo' }] },
  ]);
  assert.equal(result.clipPath, 'D:\\storage\\raw-clips\\clip-5.mp4');
  assert.ok(!calls.some(([name]) => name === 'markClipFailed'));
});

test('prepareClip gagal: markClipFailed dipanggil, tidak throw', async () => {
  const { db, calls } = fakeClipDb();
  const result = await prepareClip(
    { type: 'prepare_clip', clip_id: 5 },
    prepareDeps(db, { clipSegment: async () => { throw new Error('yt-dlp down'); } }),
  );

  assert.deepEqual(result, { failed: true, error: 'yt-dlp down' });
  assert.deepEqual(calls.find(([name]) => name === 'markClipFailed'), ['markClipFailed', 5, 'yt-dlp down']);
  assert.ok(!calls.some(([name]) => name === 'markClipReady'));
});

test('prepareClip idempoten: file ada -> clip ulang dilewati, status ready', async () => {
  const { db, calls } = fakeClipDb({
    clip: { ...CLIP, raw_clip_path: 'D:\\storage\\raw-clips\\clip-5.mp4', prepare_status: 'ready' },
  });
  let clipCalls = 0;
  const result = await prepareClip(
    { type: 'prepare_clip', clip_id: 5 },
    prepareDeps(db, {
      fileExists: async () => true,
      clipSegment: async () => { clipCalls++; return { clipPath: 'x' }; },
    }),
  );

  assert.equal(result.skipped, true);
  assert.equal(clipCalls, 0);
  assert.deepEqual(calls.find(([name]) => name === 'markClipReady'), [
    'markClipReady', 5, { rawClipPath: 'D:\\storage\\raw-clips\\clip-5.mp4' },
  ]);
});

test('db params: JSON diserialisasi dan INSERT memakai NOW()', () => {
  const params = toClipParams(7, {
    title: 'Klip', start_sec: '10.5', end_sec: '42.25', viral_score: '90',
    hook_type: 'story', reason: 'alasan', suggested_caption: 'caption',
    subtitle_json: [{ start: 0, end: 1, text: 'hai' }],
  });

  assert.equal(typeof params[2], 'number');
  assert.equal(params[8], '[{"start":0,"end":1,"text":"hai"}]');
  assert.equal(params[9], null);
  assert.equal(jsonOrNull({ a: 1 }), '{"a":1}');
  assert.equal(jsonOrNull(null), null);
  assert.equal(CLIP_INSERT_SQL.match(/NOW\(\)/g).length, 2);
});
