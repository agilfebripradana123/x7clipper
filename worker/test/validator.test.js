import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClips, deduplicateClips } from '../src/validator.js';

const segmentMap = {
  S1: { start: 0, end: 8, text: 'a' },
  S2: { start: 8, end: 16, text: 'b' },
  S3: { start: 16, end: 24, text: 'c' },
  S4: { start: 24, end: 32, text: 'd' },
  S5: { start: 32, end: 40, text: 'e' },
  S6: { start: 40, end: 48, text: 'f' },
  S7: { start: 48, end: 56, text: 'g' },
  S8: { start: 56, end: 64, text: 'h' },
  S9: { start: 64, end: 72, text: 'i' },
  S10: { start: 72, end: 80, text: 'j' },
};

test('klip valid: resolve segment ID ke detik + padding', () => {
  const raw = [{
    title: 'Hook bagus',
    start_segment_id: 'S1',
    end_segment_id: 'S5',
    viral_score: 85,
    hook_type: 'contrarian',
    reason: 'Alasan',
    suggested_caption: 'Caption',
    auto_edit: {
      hook_banner_text: 'RAHASIA VIRAL CEPAT',
      recommended_layout: 'full_crop',
      highlight_keywords: ['RAHASIA', 'VIRAL'],
    },
  }];

  const result = validateClips(raw, segmentMap, 80);
  assert.equal(result.length, 1);
  // padding: start - 0.35 = -0.35 -> clamped 0, end + 0.50 = 40.50
  assert.equal(result[0].start_sec, 0);
  assert.equal(result[0].end_sec, 40.50);
  assert.equal(result[0].auto_edit.hook_banner_text, 'RAHASIA VIRAL CEPAT');
  assert.equal(result[0].auto_edit.recommended_layout, 'full_crop');
});

test('tolak klip dengan segment ID tidak ada di segmentMap', () => {
  const raw = [{
    title: 'Invalid',
    start_segment_id: 'S99',
    end_segment_id: 'S100',
    viral_score: 50,
    hook_type: 'story',
    reason: 'r',
    suggested_caption: 'c',
  }];

  const result = validateClips(raw, segmentMap, 80);
  assert.equal(result.length, 0);
});

test('tolak klip durasi < 15 detik', () => {
  const raw = [{
    title: 'Terlalu pendek',
    start_segment_id: 'S1',
    end_segment_id: 'S2',
    viral_score: 80,
    hook_type: 'story',
    reason: 'r',
    suggested_caption: 'c',
  }];
  // S1.start=0, S2.end=16, duration 16 + padding = 16.85 -> masih < 15? no, 16.85 > 15. Pake S1-S1 saja: 0..8 = 8s
  const raw2 = [{
    title: 'Terlalu pendek',
    start_segment_id: 'S1',
    end_segment_id: 'S1',
    viral_score: 80,
    hook_type: 'story',
    reason: 'r',
    suggested_caption: 'c',
  }];
  const result = validateClips(raw2, segmentMap, 80);
  assert.equal(result.length, 0);
});

test('tolak klip durasi > 110 detik', () => {
  const bigMap = {};
  for (let i = 1; i <= 20; i++) bigMap[`S${i}`] = { start: (i - 1) * 8, end: i * 8, text: `t${i}` };
  // S1..S20 = 0..160 detik = 160s > 110
  const raw = [{
    title: 'Terlalu panjang',
    start_segment_id: 'S1',
    end_segment_id: 'S20',
    viral_score: 70,
    hook_type: 'debate',
    reason: 'r',
    suggested_caption: 'c',
  }];
  const result = validateClips(raw, bigMap, 160);
  assert.equal(result.length, 0);
});

test('tolak klip dengan end <= start (segment terbalik)', () => {
  const raw = [{
    title: 'Terbalik',
    start_segment_id: 'S5',
    end_segment_id: 'S1',
    viral_score: 60,
    hook_type: 'emotional',
    reason: 'r',
    suggested_caption: 'c',
  }];
  const result = validateClips(raw, segmentMap, 80);
  assert.equal(result.length, 0);
});

test('tolak klip dengan skema field tidak lengkap', () => {
  const raw = [{ title: 'No segments' }];
  const result = validateClips(raw, segmentMap, 80);
  assert.equal(result.length, 0);
});

test('deduplikasi: overlap > 50% durasi terpendek, simpan viral_score tertinggi', () => {
  const clips = [
    { title: 'A', start_sec: 0, end_sec: 40, viral_score: 80 },
    { title: 'B', start_sec: 5, end_sec: 42, viral_score: 92 },
    { title: 'C', start_sec: 60, end_sec: 90, viral_score: 75 },
  ];
  // A & B: overlap = 35, min dur = 37, 35/37 = 94% > 50% -> simpan B (skor 92)
  const result = deduplicateClips(clips);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'B');
  assert.equal(result[1].title, 'C');
});

test('deduplikasi: overlap <= 50% keduanya tetap', () => {
  const clips = [
    { title: 'X', start_sec: 0, end_sec: 40, viral_score: 80 },
    { title: 'Y', start_sec: 30, end_sec: 70, viral_score: 85 },
  ];
  // overlap = 10, min dur = 40, 10/40 = 25% < 50% -> keduanya tetap
  const result = deduplicateClips(clips);
  assert.equal(result.length, 2);
});
