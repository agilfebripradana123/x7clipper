import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkSegments } from '../src/chunker.js';

function segmentAt(start, duration = 60) {
  return { id: `S${start}`, start, end: start + duration, text: `Teks pada ${start}` };
}

test('video kurang dari 20 menit dikirim utuh dalam satu chunk', () => {
  const segments = [segmentAt(0), segmentAt(300), segmentAt(590, 10)];
  const chunks = chunkSegments(segments, 600);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[0].startSec, 0);
  assert.equal(chunks[0].endSec, 600);
  assert.deepEqual(chunks[0].segments, segments);
  assert.match(chunks[0].formattedText, /\[S0\|0\] Teks pada 0/);
});

test('video tepat 20 menit memakai sliding window 15 menit', () => {
  const segments = [segmentAt(0), segmentAt(779), segmentAt(780), segmentAt(899), segmentAt(900), segmentAt(1140, 60)];
  const chunks = chunkSegments(segments, 1200);

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(({ startSec, endSec }) => [startSec, endSec]), [[0, 900], [780, 1200]]);
  assert.ok(chunks[0].segments.some(({ id }) => id === 'S780'));
  assert.ok(chunks[1].segments.some(({ id }) => id === 'S780'));
  assert.ok(!chunks[1].segments.some(({ id }) => id === 'S0'));
});

test('video 50 menit menghasilkan window 15 menit dengan overlap 2 menit', () => {
  const segments = Array.from({ length: 50 }, (_, i) => segmentAt(i * 60));
  const chunks = chunkSegments(segments, 3000);

  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks.map(({ startSec, endSec }) => [startSec, endSec]), [
    [0, 900], [780, 1680], [1560, 2460], [2340, 3000],
  ]);
  assert.ok(chunks[1].segments.some(({ id }) => id === 'S840'));
  assert.ok(chunks[2].segments.some(({ id }) => id === 'S1620'));
  assert.ok(chunks[3].segments.some(({ id }) => id === 'S2400'));
});

test('segmen melintasi batas window dimasukkan ke setiap chunk yang beririsan', () => {
  const chunks = chunkSegments([segmentAt(850, 100)], 1500);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].segments.length, 1);
  assert.equal(chunks[1].segments.length, 1);
});
