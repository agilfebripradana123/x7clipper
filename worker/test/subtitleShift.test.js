import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftSubtitles, toSrt, toAss } from '../src/subtitleShift.js';

const sampleSegments = [
  { start: 5, end: 9, text: 'Sebelum klip' },
  { start: 10, end: 14, text: 'Di awal klip' },
  { start: 14, end: 18, text: 'Di tengah klip' },
  { start: 18, end: 24, text: 'Di akhir klip' },
  { start: 25, end: 30, text: 'Setelah klip' },
];

test('shiftSubtitles mengambil segmen dalam rentang dan menggeser timestamp mundur', () => {
  // Rentang klip: 11.5s sampai 21.0s (durasi = 9.5s)
  const result = shiftSubtitles(sampleSegments, 11.5, 21.0);

  assert.equal(result.length, 3);

  // Segmen 1 (10..14): clamped start di 11.5 -> relative 0.0, end di 14.0 -> relative 2.5
  assert.deepEqual(result[0], { start: 0.0, end: 2.5, text: 'Di awal klip' });

  // Segmen 2 (14..18): start 14-11.5 = 2.5, end 18-11.5 = 6.5
  assert.deepEqual(result[1], { start: 2.5, end: 6.5, text: 'Di tengah klip' });

  // Segmen 3 (18..24): start 18-11.5 = 6.5, clamped end di 21.0 -> relative 9.5
  assert.deepEqual(result[2], { start: 6.5, end: 9.5, text: 'Di akhir klip' });
});

test('shiftSubtitles mengembalikan array kosong jika tidak ada irisan', () => {
  const result = shiftSubtitles(sampleSegments, 35, 50);
  assert.equal(result.length, 0);
});

test('toSrt menghasilkan format SRT valid', () => {
  const subs = [
    { start: 0.0, end: 2.5, text: 'Halo dunia' },
    { start: 65.123, end: 68.456, text: 'Menit kedua' },
  ];
  const srt = toSrt(subs);

  assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:02,500\nHalo dunia'));
  assert.ok(srt.includes('2\n00:01:05,123 --> 00:01:08,456\nMenit kedua'));
});

test('toAss menghasilkan script ASS dengan header dan event dialog', () => {
  const subs = [
    { start: 0.0, end: 2.5, text: 'Teks pertama' },
  ];
  const ass = toAss(subs, { fontName: 'Arial', fontSize: 24 });

  assert.ok(ass.includes('[Script Info]'));
  assert.ok(ass.includes('Style: Default,Arial,24'));
  assert.ok(ass.includes('Dialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,Teks pertama'));
});
