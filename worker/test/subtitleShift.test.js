import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftSubtitles, splitViralSubtitles, detectJumpCuts, toSrt, toAss, sanitizeAssText, sanitizeDrawtext, subtitleLayout } from '../src/subtitleShift.js';

const sampleSegments = [
  { start: 5, end: 9, text: 'Sebelum klip' },
  { start: 10, end: 14, text: 'Di awal klip' },
  { start: 14, end: 18, text: 'Di tengah klip' },
  { start: 18, end: 24, text: 'Di akhir klip' },
  { start: 25, end: 30, text: 'Setelah klip' },
];

test('shiftSubtitles mengambil segmen dalam rentang dan menggeser timestamp mundur', () => {
  // Rentang klip: 11.5s sampai 21.0s (durasi = 9.5s) dengan lead compensation default 0.18s
  const result = shiftSubtitles(sampleSegments, 11.5, 21.0);

  assert.equal(result.length, 3);

  // Segmen 1 (10..14): clamped start di 11.5 -> relative 0.0, end di 14.0 -> relative 2.5 - 0.18 = 2.32
  assert.deepEqual(result[0], { start: 0.0, end: 2.32, text: 'Di awal klip' });

  // Segmen 2 (14..18): start 14-11.5-0.18 = 2.32, end 18-11.5-0.18 = 6.32
  assert.deepEqual(result[1], { start: 2.32, end: 6.32, text: 'Di tengah klip' });

  // Segmen 3 (18..24): start 18-11.5-0.18 = 6.32, clamped end di 21.0 -> relative 9.5 - 0.18 = 9.32
  assert.deepEqual(result[2], { start: 6.32, end: 9.32, text: 'Di akhir klip' });
});

test('shiftSubtitles dengan leadCompensation=0 mempertahankan timestamp persis', () => {
  const result = shiftSubtitles(sampleSegments, 11.5, 21.0, { leadCompensation: 0 });
  assert.equal(result[0].start, 0.0);
  assert.equal(result[0].end, 2.5);
  assert.equal(result[1].start, 2.5);
  assert.equal(result[1].end, 6.5);
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
  assert.ok(ass.includes('Dialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,TEKS PERTAMA'));
});

test('toAss mendukung highlight keywords warna kontras', () => {
  const subs = [{ start: 0.0, end: 2.0, text: 'konten rahasia viral' }];
  const ass = toAss(subs, { highlightKeywords: ['RAHASIA'] });
  assert.ok(ass.includes('{\\c&H0000E6FF&}RAHASIA{\\c&H00FFFFFF&}'));
});

test('detectJumpCuts mendeteksi jeda hening lebih dari 1.2 detik', () => {
  const subs = [
    { start: 1.0, end: 4.0, text: 'segmen satu' },
    // gap 4.0 -> 7.0 (3 detik hening)
    { start: 7.0, end: 12.0, text: 'segmen dua' },
  ];
  const cuts = detectJumpCuts(subs, 15, { minGapSec: 1.2, bufferSec: 0.15 });
  assert.equal(cuts.length, 2);
  assert.equal(cuts[0].start, 0.85); // 1.0 - 0.15
  assert.equal(cuts[0].end, 4.15);   // 4.0 + 0.15
  assert.equal(cuts[1].start, 6.85); // 7.0 - 0.15
  assert.equal(cuts[1].end, 12.15);  // 12.0 + 0.15
});

test('splitViralSubtitles memecah baris panjang jadi 2-3 kata proporsional', () => {
  const subs = [
    { start: 0.0, end: 6.0, text: 'satu dua tiga empat lima enam' },
  ];
  const viral = splitViralSubtitles(subs, { maxWordsPerLine: 3 });

  assert.equal(viral.length, 2);
  assert.equal(viral[0].text, 'satu dua tiga');
  assert.equal(viral[1].text, 'empat lima enam');
  assert.equal(viral[0].start, 0.0);
  assert.equal(viral[1].end, 6.0);
  assert.ok(viral[0].end <= viral[1].start + 0.01);
});

test('sanitizeAssText dan sanitizeDrawtext membersihkan karakter berbahaya', () => {
  assert.equal(sanitizeAssText('Halo {rusak} \\pos(1,2) dunia'), 'Halo rusak pos(1,2) dunia');
  assert.equal(sanitizeDrawtext("Judul 'Kutip': 100% aman"), "Judul ’Kutip’\\: 100\\% aman");
});

test('subtitleLayout mengembalikan alignment dan marginV presisi', () => {
  assert.deepEqual(subtitleLayout('bottom'), { alignment: 2, marginV: 240 });
  assert.deepEqual(subtitleLayout('middle'), { alignment: 5, marginV: 0 });
  assert.deepEqual(subtitleLayout('top', false), { alignment: 8, marginV: 160 });
  assert.deepEqual(subtitleLayout('top', true), { alignment: 8, marginV: 340 });
});

test('toAss menerapkan offsetSec dan sanitasi bebas artefak 12)}', () => {
  const subs = [{ start: 1.0, end: 3.0, text: 'Halo {tag} dunia' }];
  const ass = toAss(subs, { offsetSec: 0.5, highlightKeywords: ['DUNIA'] });

  assert.ok(ass.includes('Dialogue: 0,0:00:01.50,0:00:03.50,Default,,0,0,0,,HALO TAG {\\c&H0000E6FF&}DUNIA{\\c&H00FFFFFF&}'));
  assert.ok(!ass.includes('12)}'));
});
