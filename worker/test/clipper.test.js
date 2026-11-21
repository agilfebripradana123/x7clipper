import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSegment } from '../src/clipper.js';

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
