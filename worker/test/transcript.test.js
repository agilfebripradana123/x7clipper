import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript, parseTimestamp } from '../src/transcript.js';

test('parse timestamp VTT dan SRT ke detik float', () => {
  assert.equal(parseTimestamp('00:01:23.456'), 83.456);
  assert.equal(parseTimestamp('01:23.456'), 83.456);
  assert.equal(parseTimestamp('00:01:23,456'), 83.456);
});

test('parse cue VTT dan bersihkan tag serta rolling duplicate', () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000 align:start position:0%
<c>Halo</c>

00:00:02.000 --> 00:00:04.000
<v Speaker>Halo dunia</v>

00:00:04.000 --> 00:00:06.500
<00:00:04.000>Halo dunia, selamat datang.
`;

  const { segments, segmentMap, formattedText } = parseTranscript(vtt);
  assert.equal(segments.length, 1);
  assert.deepEqual(segmentMap.S1, { start: 0, end: 6.5, text: 'Halo dunia, selamat datang.' });
  assert.equal(formattedText, '[S1|0] Halo dunia, selamat datang.');
});

test('gabung cue jadi segmen berdurasi 6 sampai 10 detik pada akhir kalimat', () => {
  const srt = `1
00:00:00,000 --> 00:00:02,000
Halo semua

2
00:00:02,000 --> 00:00:04,000
hari ini kita belajar

3
00:00:04,000 --> 00:00:06,500
membuat klip video.

4
00:00:06,500 --> 00:00:09,000
Pertama kita ambil

5
00:00:09,000 --> 00:00:12,500
transkrip dari video.
`;

  const { segments, segmentMap, formattedText } = parseTranscript(srt);
  assert.equal(segments.length, 2);
  assert.deepEqual(segmentMap.S1, { start: 0, end: 6.5, text: 'Halo semua hari ini kita belajar membuat klip video.' });
  assert.deepEqual(segmentMap.S2, { start: 6.5, end: 12.5, text: 'Pertama kita ambil transkrip dari video.' });
  assert.equal(formattedText, '[S1|0] Halo semua hari ini kita belajar membuat klip video.\n[S2|6] Pertama kita ambil transkrip dari video.');
  assert.ok(segments.every(({ start, end }) => end - start >= 6 && end - start <= 10));
});

test('potong paksa di maksimum 10 detik tanpa tanda baca', () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:03.000
satu dua tiga

00:00:03.000 --> 00:00:06.000
empat lima enam

00:00:06.000 --> 00:00:10.200
tujuh delapan sembilan
`;
  const { segments } = parseTranscript(vtt);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(({ start, end }) => [start, end]), [[0, 6], [6, 10.2]]);
  assert.ok(segments.every(({ start, end }) => end - start <= 10.0));
});
