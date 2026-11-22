import test from 'node:test';
import assert from 'node:assert/strict';
import { determinePacing, buildCutsFromKeptCues, calculateActiveDuration } from '../src/agents/semanticPacer.js';

test('buildCutsFromKeptCues memotong cue yang didrop dan menggabungkan segmen berdekatan', () => {
  const cueMap = {
    C1: { id: 'C1', start: 0.0, end: 5.0, text: 'intro' },
    C2: { id: 'C2', start: 5.2, end: 12.0, text: 'filler' }, // didrop
    C3: { id: 'C3', start: 15.0, end: 25.0, text: 'daging' },
    C4: { id: 'C4', start: 25.2, end: 35.0, text: 'lanjutan daging' }, // gap 0.2s -> di-merge dengan C3
  };

  const cuts = buildCutsFromKeptCues(cueMap, ['C2'], 40);

  // C1 (0..5) dan C3+C4 (15..35)
  assert.equal(cuts.length, 2);
  assert.equal(cuts[0].start, 0);
  assert.equal(cuts[0].end, 5.15); // 5.0 + 0.15
  assert.equal(cuts[1].start, 14.85); // 15 - 0.15
  assert.equal(cuts[1].end, 35.15);  // 35 + 0.15
});

test('calculateActiveDuration menghitung total detik cuts', () => {
  const cuts = [
    { start: 0, end: 10 },
    { start: 20, end: 35 },
  ];
  assert.equal(calculateActiveDuration(cuts), 25);
});

test('determinePacing lolos dalam 1 iterasi jika durasi <= 58 detik', async () => {
  const cueMap = {
    C1: { id: 'C1', start: 0.0, end: 15.0, text: 'hook pembuka' },
    C2: { id: 'C2', start: 16.0, end: 35.0, text: 'isi penting' },
  };

  const fakeResponse = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            drop_cue_ids: [],
            hook_banner_text: 'HOOK KEREN BANGET',
            highlight_keywords: ['HOOK', 'KEREN'],
            pacing_reason: 'Semua bagian penting dan tempo sudah pas.',
          }),
        },
      },
    ],
  };

  const fetchFn = async () => ({
    ok: true,
    text: async () => JSON.stringify(fakeResponse),
  });

  const result = await determinePacing('cues...', cueMap, 40, {
    baseUrl: 'https://api.9router.com/v1',
    apiKey: 'secret',
    model: 'pacer-model',
    fetchFn,
  });

  assert.equal(result.iterations, 1);
  assert.equal(result.hook_banner_text, 'HOOK KEREN BANGET');
  assert.ok(calculateActiveDuration(result.cuts) <= 58);
});

test('determinePacing menerima video panjang tanpa batasan cap 58 detik', async () => {
  const cueMap = {
    C1: { id: 'C1', start: 0.0, end: 25.0, text: 'hook panjang' },
    C2: { id: 'C2', start: 26.0, end: 55.0, text: 'penjelasan awal' },
    C3: { id: 'C3', start: 56.0, end: 75.0, text: 'penjelasan filler' },
    C4: { id: 'C4', start: 76.0, end: 95.0, text: 'punchline akhir' },
  };

  const fetchFn = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            drop_cue_ids: ['C3'],
            hook_banner_text: 'KISAH LENGKAP UTUH',
            highlight_keywords: ['KISAH'],
            pacing_reason: 'Hanya buang filler C3, pertahankan narasi utuh.',
          }),
        },
      }],
    }),
  });

  const result = await determinePacing('cues...', cueMap, 100, {
    baseUrl: 'https://api.9router.com/v1',
    apiKey: 'secret',
    model: 'pacer-model',
    fetchFn,
  });

  assert.equal(result.iterations, 1);
  assert.equal(result.hook_banner_text, 'KISAH LENGKAP UTUH');
  const duration = calculateActiveDuration(result.cuts);
  assert.ok(duration > 58); // Bebas berapapun durasinya sesuai konteks
});
