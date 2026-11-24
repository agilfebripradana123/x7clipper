import test from 'node:test';
import assert from 'node:assert/strict';
import { refineClipBoundaries } from '../src/boundaryRefiner.js';

test('refineClipBoundaries mundurkan awal jika diawali kata sambung gantung (tapi)', () => {
  const cues = [
    { id: 'S1', start: 0.0, end: 4.5, text: 'Halo selamat datang di channel kita.' },
    { id: 'S2', start: 4.6, end: 8.0, text: 'Hari ini kita mau bahas rahasia bisnis.' },
    { id: 'S3', start: 8.1, end: 12.0, text: 'Tapi sebenarnya banyak orang yang tidak tahu hal ini.' },
    { id: 'S4', start: 12.1, end: 18.0, text: 'Kuncinya ada di konsistensi dan fokus harian.' },
  ];

  // Awal dimulai di S3 ("Tapi sebenarnya...")
  const refined = refineClipBoundaries(cues, 2, 3);
  // Harus mundur ke S2 ("Hari ini kita...")
  assert.equal(refined.startIdx, 1);
  assert.equal(refined.endIdx, 3);
});

test('refineClipBoundaries tidak mundur jika sudah ada jeda alami sebelumnya', () => {
  const cues = [
    { id: 'S1', start: 0.0, end: 4.0, text: 'Poin pertama selesai.' },
    { id: 'S2', start: 5.5, end: 10.0, text: 'Dan sekarang kita masuk ke poin kedua.' }, // Jeda 1.5s
  ];

  const refined = refineClipBoundaries(cues, 1, 1);
  assert.equal(refined.startIdx, 1);
});

test('refineClipBoundaries majukan akhir jika diakhiri kata sambung gantung (karena)', () => {
  const cues = [
    { id: 'S1', start: 0.0, end: 5.0, text: 'Kita harus belajar setiap hari.' },
    { id: 'S2', start: 5.1, end: 9.0, text: 'Banyak orang gagal di tengah jalan karena' },
    { id: 'S3', start: 9.1, end: 14.0, text: 'mereka tidak sabar menunggu hasilnya berbuah.' },
    { id: 'S4', start: 14.5, end: 20.0, text: 'Topik berikutnya adalah manajemen uang.' },
  ];

  // Akhir terpotong di S2 ("...karena")
  const refined = refineClipBoundaries(cues, 0, 1);
  // Harus maju ke S3 yang menuntaskan kalimat
  assert.equal(refined.startIdx, 0);
  assert.equal(refined.endIdx, 2);
});

test('refineClipBoundaries majukan akhir jika cue tidak ada tanda baca akhir dan jeda rapat', () => {
  const cues = [
    { id: 'S1', start: 0.0, end: 4.0, text: 'Ini adalah strategi yang ampuh' },
    { id: 'S2', start: 4.1, end: 8.0, text: 'untuk meningkatkan penjualan produk kita.' },
    { id: 'S3', start: 10.0, end: 15.0, text: 'Sekarang mari kita lihat contoh kasusnya.' },
  ];

  // S1 tidak ada titik dan jarak ke S2 hanya 0.1s
  const refined = refineClipBoundaries(cues, 0, 0);
  assert.equal(refined.endIdx, 1);
});
