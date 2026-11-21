import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSampleFrames, buildIndexedCues } from '../src/agents/perception.js';

test('buildIndexedCues membuat ID cue dan menandai jeda hening', () => {
  const subs = [
    { start: 0.5, end: 3.2, text: 'Halo selamat datang' },
    { start: 3.4, end: 5.0, text: 'di video ini' },
    { start: 7.0, end: 9.5, text: 'topik utama hari ini' }, // gap 2.0s
  ];

  const { formattedCues, cueMap } = buildIndexedCues(subs);

  assert.ok(formattedCues.includes('[C1|0.50-3.20] Halo selamat datang'));
  assert.ok(formattedCues.includes('[C2|3.40-5.00] di video ini'));
  assert.ok(formattedCues.includes('--- [GAP 2s hening] ---') || formattedCues.includes('--- [GAP 2.00s hening] ---') || formattedCues.includes('GAP 2'));
  assert.ok(formattedCues.includes('[C3|7.00-9.50] topik utama hari ini'));

  assert.equal(cueMap.C1.start, 0.5);
  assert.equal(cueMap.C1.end, 3.2);
  assert.equal(cueMap.C3.text, 'topik utama hari ini');
});

test('extractSampleFrames mengekstrak 3 frame dan mengembalikan base64 data URL', async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push({ bin, args });
    return { stdout: '' };
  };
  const read = async () => Buffer.from('fake-jpeg-data');
  const removed = [];
  const remove = async (f) => removed.push(f);
  const makeDir = async () => {};

  const frames = await extractSampleFrames('dummy.mp4', 60, 'tmp-test', {
    run,
    read,
    remove,
    makeDir,
  });

  assert.equal(frames.length, 3);
  assert.ok(frames[0].startsWith('data:image/jpeg;base64,'));
  assert.equal(calls.length, 3);
  // Posisi 15% dari 60 = 9s, 50% = 30s, 85% = 51s
  assert.ok(calls[0].args.includes('9'));
  assert.ok(calls[1].args.includes('30'));
  assert.ok(calls[2].args.includes('51'));
  // File temp selalu dihapus
  assert.equal(removed.length, 3);
});

test('extractSampleFrames menolak durasi tidak valid', async () => {
  await assert.rejects(() => extractSampleFrames('dummy.mp4', 0, 'tmp'), RangeError);
  await assert.rejects(() => extractSampleFrames('dummy.mp4', -10, 'tmp'), RangeError);
});
