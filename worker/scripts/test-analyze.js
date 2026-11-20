#!/usr/bin/env node
/**
 * CLI runner end-to-end: URL YouTube -> transkrip -> chunk -> 9router -> validasi -> hasil klip.
 *
 * Usage:
 *   node scripts/test-analyze.js <youtube-url>
 *   node scripts/test-analyze.js https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *
 * Membutuhkan:
 *   - yt-dlp di PATH (atau YTDLP_PATH di .env)
 *   - .env dengan NINEROUTER_BASE_URL, NINEROUTER_API_KEY, NINEROUTER_MODEL
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVideoMetadata, downloadTranscript } from '../src/youtube.js';
import { parseTranscript } from '../src/transcript.js';
import { chunkSegments } from '../src/chunker.js';
import { selectClipsFromChunk } from '../src/ninerouter.js';
import { validateClips, deduplicateClips } from '../src/validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env sederhana (tanpa dependency dotenv)
async function loadEnv() {
  try {
    const envPath = resolve(__dirname, '../../.env');
    const text = await readFile(envPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env optional jika env vars sudah diset */ }
}

function log(label, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}: ${msg}`);
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/test-analyze.js <youtube-url>');
    process.exit(1);
  }

  await loadEnv();

  // 1. Metadata
  log('META', 'Mengambil metadata video...');
  const meta = await getVideoMetadata(url);
  log('META', `"${meta.title}" (${meta.duration_sec}s) — subtitle: ${meta.subtitles_available.join(', ') || 'tidak ada info'}`);

  // 2. Download transkrip
  log('TRANSCRIPT', 'Mengunduh subtitle...');
  const transcript = await downloadTranscript(url);
  log('TRANSCRIPT', `Bahasa: ${transcript.lang} (auto: ${transcript.auto}) — ${transcript.filePath}`);

  // 3. Parse & normalize
  log('PARSE', 'Parsing transkrip ke segmen...');
  const { segments, segmentMap, formattedText } = parseTranscript(transcript.content);
  log('PARSE', `${segments.length} segmen dihasilkan`);

  // 4. Chunk
  log('CHUNK', 'Memecah transkrip ke chunk...');
  const chunks = chunkSegments(segments, meta.duration_sec);
  log('CHUNK', `${chunks.length} chunk (video ${meta.duration_sec < 1200 ? '<' : '>='} 20 menit)`);

  // 5. Analisis AI per chunk
  log('AI', `Mengirim ${chunks.length} chunk ke 9router...`);
  const allRawClips = [];
  for (const chunk of chunks) {
    log('AI', `Chunk ${chunk.chunkIndex + 1}/${chunks.length} (${chunk.startSec}s - ${chunk.endSec}s, ${chunk.segments.length} segmen)...`);
    try {
      const result = await selectClipsFromChunk(chunk.formattedText);
      log('AI', `Chunk ${chunk.chunkIndex + 1}: "${result.chunk_summary}" — ${result.clips?.length || 0} klip`);
      if (result.clips?.length) allRawClips.push(...result.clips);
    } catch (err) {
      log('AI', `Chunk ${chunk.chunkIndex + 1} GAGAL: ${err.message}`);
    }
  }

  if (allRawClips.length === 0) {
    log('RESULT', 'Tidak ada klip ditemukan dari seluruh chunk.');
    return;
  }

  // 6. Validasi
  log('VALIDATE', `Memvalidasi ${allRawClips.length} klip mentah...`);
  const validClips = validateClips(allRawClips, segmentMap, meta.duration_sec);
  log('VALIDATE', `${validClips.length} klip lolos validasi dari ${allRawClips.length} mentah`);

  // 7. Deduplikasi
  const finalClips = deduplicateClips(validClips);
  log('DEDUP', `${finalClips.length} klip final setelah deduplikasi`);

  // 8. Output
  console.log('\n' + '='.repeat(60));
  console.log('HASIL ANALISIS');
  console.log('='.repeat(60));
  console.log(`Video: ${meta.title}`);
  console.log(`Durasi: ${meta.duration_sec}s | Chunk: ${chunks.length} | Klip final: ${finalClips.length}`);
  console.log('-'.repeat(60));

  for (const clip of finalClips) {
    const dur = (clip.end_sec - clip.start_sec).toFixed(1);
    console.log(`\n📌 ${clip.title}`);
    console.log(`   Waktu  : ${clip.start_sec.toFixed(2)}s - ${clip.end_sec.toFixed(2)}s (${dur}s)`);
    console.log(`   Segment: ${clip.start_segment_id} - ${clip.end_segment_id}`);
    console.log(`   Skor   : ${clip.viral_score}/100 | Hook: ${clip.hook_type}`);
    console.log(`   Alasan : ${clip.reason}`);
    console.log(`   Caption: ${clip.suggested_caption}`);
  }

  // Simpan hasil JSON
  const outPath = resolve(__dirname, `../../storage/tmp/analysis-${meta.id}.json`);
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ video: meta, chunks: chunks.length, clips: finalClips }, null, 2));
  console.log(`\n💾 Hasil disimpan: ${outPath}`);
}

main().catch((err) => {
  console.error(`\n❌ FATAL: ${err.message}`);
  process.exit(1);
});
