import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVideoMetadata,
  downloadTranscript,
  InvalidUrlError,
  VideoTooShortError,
  TranscriptNotFoundError,
} from '../src/youtube.js';

const VALID_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SHORT_URL = 'https://youtu.be/dQw4w9WgXcQ';

test('tolak URL bukan YouTube', async () => {
  await assert.rejects(() => getVideoMetadata('https://vimeo.com/12345'), InvalidUrlError);
  await assert.rejects(() => downloadTranscript('https://example.com'), InvalidUrlError);
});

test('tolak video durasi < 60 detik', async () => {
  const run = async () => ({ stdout: JSON.stringify({ id: 'dQw4w9WgXcQ', duration: 45, title: 'Short' }) });
  await assert.rejects(() => getVideoMetadata(VALID_URL, { run }), VideoTooShortError);
});

test('ambil metadata video valid', async () => {
  const run = async () => ({
    stdout: JSON.stringify({
      id: 'dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      duration: 213,
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      subtitles: { en: [] },
      automatic_captions: { id: [] },
    }),
  });

  const meta = await getVideoMetadata(SHORT_URL, { run });
  assert.equal(meta.id, 'dQw4w9WgXcQ');
  assert.equal(meta.duration_sec, 213);
  assert.equal(meta.title, 'Rick Astley - Never Gonna Give You Up');
  assert.deepEqual(meta.subtitles_available, ['en', 'auto:id']);
});

test('tolak jika tidak ada subtitle bahasa id atau en', async () => {
  const run = async () => ({
    stdout: JSON.stringify({
      id: 'dQw4w9WgXcQ',
      duration: 120,
      subtitles: { ja: [] },
      automatic_captions: {},
    }),
  });
  await assert.rejects(() => downloadTranscript(VALID_URL, { run }), TranscriptNotFoundError);
});

test('download subtitle manual bahasa id diprioritaskan', async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push({ bin, args });
    return {
      stdout: JSON.stringify({
        id: 'dQw4w9WgXcQ',
        duration: 120,
        subtitles: { en: [], id: [] },
        automatic_captions: { id: [] },
      }),
    };
  };
  const files = {
    'E:\\gilfp\\x7clip\\storage\\transcripts\\dQw4w9WgXcQ.id.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHalo dunia',
  };
  const read = async (p) => {
    const norm = p.replace(/\//g, '\\');
    const hit = Object.keys(files).find((k) => norm.endsWith('dQw4w9WgXcQ.id.vtt'));
    if (hit) return files[hit];
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  };
  const makeDir = async () => {};

  const result = await downloadTranscript(VALID_URL, { run, read, makeDir, transcriptsDir: 'storage/transcripts' });
  assert.equal(result.lang, 'id');
  assert.equal(result.auto, false);
  assert.match(result.content, /Halo dunia/);
  // Verifikasi flag --write-sub dipakai (bukan --write-auto-sub)
  assert.ok(calls[1].args.includes('--write-sub'));
  assert.ok(!calls[1].args.includes('--write-auto-sub'));
});

test('fallback ke auto-caption jika manual tidak ada', async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push({ bin, args });
    return {
      stdout: JSON.stringify({
        id: 'dQw4w9WgXcQ',
        duration: 120,
        subtitles: {},
        automatic_captions: { en: [] },
      }),
    };
  };
  const read = async () => 'WEBVTT\n\n00:00.000 --> 00:05.000\nHello world';
  const makeDir = async () => {};

  const result = await downloadTranscript(VALID_URL, { run, read, makeDir });
  assert.equal(result.lang, 'en');
  assert.equal(result.auto, true);
  assert.ok(calls[1].args.includes('--write-auto-sub'));
});
