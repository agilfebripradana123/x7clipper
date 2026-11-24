import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSegment, parseSilencesFromStderr, snapBoundariesToSilence } from '../src/clipper.js';

const URL = 'https://youtu.be/dQw4w9WgXcQ';

test('tolak rentang clip tidak valid', async () => {
  await assert.rejects(() => clipSegment(URL, -1, 20), RangeError);
  await assert.rejects(() => clipSegment(URL, 20, 20), RangeError);
  await assert.rejects(() => clipSegment(URL, 30, 20), RangeError);
});

test('download section parsial lalu re-encode via FFmpeg', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '' };
  };
  const stat = async () => ({ size: 8_120_340 });
  const unlink = async () => {};
  const makeDir = async () => {};

  const result = await clipSegment(URL, 10.25, 52.75, {
    clipId: 'clip-abc',
    tempDir: 'temp-dir',
    outputDir: 'output-dir',
    enableSilenceSnap: false,
    run,
    stat,
    unlink,
    makeDir,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, process.env.YTDLP_PATH || 'yt-dlp');
  assert.deepEqual(calls[0].args.slice(0, 4), [
    '--download-sections', '*10.25-52.75', '--force-keyframes-at-cuts', '--ffmpeg-location',
  ]);
  assert.ok(calls[0].args.includes('--skip-download') === false);
  assert.ok(calls[0].args.some((a) => a.includes('height<=1440')));
  assert.ok(calls[0].args.includes('--retries'));
  assert.ok(calls[0].args.includes('--merge-output-format'));
  assert.equal(calls[0].args[calls[0].args.indexOf('--merge-output-format') + 1], 'mp4');

  assert.equal(calls[1].command, process.env.FFMPEG_PATH || 'ffmpeg');
  assert.ok(calls[1].args.includes('libx264'));
  assert.ok(calls[1].args.includes('veryfast'));
  assert.ok(calls[1].args.includes('aac'));
  assert.ok(calls[1].args.includes('+faststart'));

  assert.equal(result.durationSec, 42.5);
  assert.equal(result.sizeBytes, 8_120_340);
  assert.match(result.clipPath.replace(/\\/g, '/'), /output-dir\/clip-abc\.mp4$/);
});

test('parseSilencesFromStderr mengekstrak jeda hening dengan benar', () => {
  const sampleStderr = `
[silencedetect @ 000001] silence_start: 1.845
[silencedetect @ 000001] silence_end: 2.340 | silence_duration: 0.495
[silencedetect @ 000001] silence_start: 15.200
[silencedetect @ 000001] silence_end: 16.000 | silence_duration: 0.800
`;
  const silences = parseSilencesFromStderr(sampleStderr);
  assert.equal(silences.length, 2);
  assert.deepEqual(silences[0], { start: 1.845, end: 2.34 });
  assert.deepEqual(silences[1], { start: 15.2, end: 16.0 });
});

test('snapBoundariesToSilence snap start dan end ke celah hening bicara', async () => {
  const fakeRun = async () => ({
    stderr: `
[silencedetect] silence_start: 1.2
[silencedetect] silence_end: 1.95
[silencedetect] silence_start: 30.4
[silencedetect] silence_end: 31.0
`,
  });

  // targetStartOffset = 2.0 (dekat silence.end 1.95) -> 1.95 - 0.15 = 1.80
  // targetEndOffset = 30.2 (dekat silence.start 30.4) -> 30.4 + 0.35 = 30.75
  const result = await snapBoundariesToSilence('video.mp4', 2.0, 30.2, {
    run: fakeRun,
  });

  assert.equal(result.actualStartOffset, 1.80);
  assert.equal(result.actualEndOffset, 30.75);
});

test('snapBoundariesToSilence fallback aman saat tidak ada jeda hening', async () => {
  const fakeRun = async () => ({ stderr: '' });

  // targetStartOffset = 2.0 -> fallback 2.0 - 0.25 = 1.75
  // targetEndOffset = 30.0 -> fallback 30.0 + 0.50 = 30.50
  const result = await snapBoundariesToSilence('video.mp4', 2.0, 30.0, {
    run: fakeRun,
  });

  assert.equal(result.actualStartOffset, 1.75);
  assert.equal(result.actualEndOffset, 30.50);
});
