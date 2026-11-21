import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

/**
 * Ekstrak 3 frame JPEG ringan pada 15%, 50%, dan 85% durasi klip mentah.
 * Output: array string base64 data URL (`data:image/jpeg;base64,...`).
 * File .jpg sementara selalu dihapus di blok finally.
 */
export async function extractSampleFrames(videoPath, durationSec, tmpDir, {
  ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
  run = execFileAsync,
  read = readFile,
  remove = unlink,
  makeDir = mkdir,
} = {}) {
  if (typeof durationSec !== 'number' || durationSec <= 0) {
    throw new RangeError(`durationSec harus positif: ${durationSec}`);
  }

  await makeDir(tmpDir, { recursive: true });

  const ratios = [0.15, 0.50, 0.85];
  const filePaths = [];
  const base64List = [];

  try {
    for (const r of ratios) {
      const sec = Number((durationSec * r).toFixed(2));
      const outPath = resolve(tmpDir, `frame-${randomUUID()}.jpg`);
      filePaths.push(outPath);

      const args = [
        '-y',
        '-ss', String(sec),
        '-i', videoPath,
        '-vframes', '1',
        '-vf', 'scale=512:-1',
        '-q:v', '5',
        outPath,
      ];

      await run(ffmpeg, args, { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });
      const buffer = await read(outPath);
      base64List.push(`data:image/jpeg;base64,${buffer.toString('base64')}`);
    }
  } finally {
    for (const f of filePaths) {
      try {
        await remove(f);
      } catch {
        /* abaikan jika file tidak ada / gagal dihapus */
      }
    }
  }

  return base64List;
}

/**
 * Format daftar subtitle klip menjadi baris ber-ID [C1|0.00-3.45] teks...
 * dan penanda jeda hening antar cue [GAP X.Xs] jika jarak antar cue > 0.4s.
 */
export function buildIndexedCues(shiftedSubtitles) {
  if (!Array.isArray(shiftedSubtitles)) return { formattedCues: '', cueMap: {} };

  const cueMap = {};
  const lines = [];

  for (let i = 0; i < shiftedSubtitles.length; i++) {
    const cue = shiftedSubtitles[i];
    const id = `C${i + 1}`;
    const start = Number(Number(cue.start).toFixed(2));
    const end = Number(Number(cue.end).toFixed(2));
    const text = String(cue.text ?? '').trim();

    cueMap[id] = { id, start, end, text, duration: Number((end - start).toFixed(2)) };

    // Cek jeda hening dengan cue sebelumnya
    if (i > 0) {
      const prevEnd = Number(Number(shiftedSubtitles[i - 1].end).toFixed(2));
      const gap = Number((start - prevEnd).toFixed(2));
      if (gap >= 0.4) {
        lines.push(`--- [GAP ${gap}s hening] ---`);
      }
    }

    lines.push(`[${id}|${start.toFixed(2)}-${end.toFixed(2)}] ${text}`);
  }

  return {
    formattedCues: lines.join('\n'),
    cueMap,
  };
}
