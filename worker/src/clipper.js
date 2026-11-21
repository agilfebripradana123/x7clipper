import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, stat as fsStat, unlink as fsUnlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultTempDir = resolve(projectRoot, 'storage/tmp');
const defaultOutputDir = resolve(projectRoot, 'storage/raw-clips');

// Load environment dari root .env jika ada
async function ensureEnv() {
  try {
    const text = await readFile(resolve(projectRoot, '.env'), 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* ignore */ }
}
await ensureEnv();

function bin(name, fallback) {
  return process.env[name] || fallback;
}

/**
 * Potong file video lokal langsung menggunakan FFmpeg tanpa yt-dlp.
 */
export async function clipLocalFile(inputPath, startSec, endSec, {
  clipId = randomUUID(),
  outputDir = defaultOutputDir,
  ffmpeg = bin('FFMPEG_PATH', 'ffmpeg'),
  run = execFileAsync,
  stat = fsStat,
  makeDir = mkdir,
} = {}) {
  if (typeof startSec !== 'number' || typeof endSec !== 'number') {
    throw new TypeError('startSec dan endSec harus number');
  }
  if (startSec < 0 || endSec <= startSec) {
    throw new RangeError(`Rentang clip tidak valid: startSec=${startSec}, endSec=${endSec}`);
  }

  await makeDir(outputDir, { recursive: true });
  const finalFile = resolve(outputDir, `${clipId}.mp4`);
  const durationSec = Number((endSec - startSec).toFixed(2));

  const ffmpegArgs = [
    '-y',
    '-ss', String(startSec),
    '-t', String(durationSec),
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    finalFile,
  ];

  await run(ffmpeg, ffmpegArgs, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  const fileInfo = await stat(finalFile);

  return {
    clipPath: finalFile,
    durationSec,
    sizeBytes: fileInfo.size,
  };
}

/**
 * Download potongan segmen parsial via yt-dlp --download-sections
 * lalu rapikan keyframe via FFmpeg (libx264 + aac + movflags +faststart)
 * agar browser langsung memutar tanpa freeze.
 */
export async function clipSegment(url, startSec, endSec, {
  clipId = randomUUID(),
  tempDir = defaultTempDir,
  outputDir = defaultOutputDir,
  ytdlp = bin('YTDLP_PATH', 'yt-dlp'),
  ffmpeg = bin('FFMPEG_PATH', 'ffmpeg'),
  run = execFileAsync,
  stat = fsStat,
  unlink = fsUnlink,
  makeDir = mkdir,
} = {}) {
  if (typeof startSec !== 'number' || typeof endSec !== 'number') {
    throw new TypeError('startSec dan endSec harus number');
  }
  if (startSec < 0 || endSec <= startSec) {
    throw new RangeError(`Rentang clip tidak valid: startSec=${startSec}, endSec=${endSec}`);
  }

  await makeDir(tempDir, { recursive: true });
  await makeDir(outputDir, { recursive: true });

  const tempFile = resolve(tempDir, `temp-${clipId}.mp4`);
  const finalFile = resolve(outputDir, `${clipId}.mp4`);
  const sectionSpec = `*${startSec}-${endSec}`;

  // 1. Download potongan segmen parsial via yt-dlp
  // Ambil stream resolusi 1080p–1440p dengan format bv*[height<=1440]+ba/b dan merge ke mp4
  const ytdlpArgs = [
    '--download-sections', sectionSpec,
    '--force-keyframes-at-cuts',
    '--ffmpeg-location', dirname(ffmpeg),
    '--no-playlist',
    '--retries', '5',
    '--fragment-retries', '5',
    '-f', 'bv*[height<=1440]+ba/b',
    '--merge-output-format', 'mp4',
    '-o', tempFile,
    url,
  ];

  await run(ytdlp, ytdlpArgs, { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });

  // 2. Re-encode awal via FFmpeg agar keyframe bersih dan ada +faststart
  const ffmpegArgs = [
    '-y',
    '-i', tempFile,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    finalFile,
  ];

  try {
    await run(ffmpeg, ffmpegArgs, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  } finally {
    try { await unlink(tempFile); } catch { /* ignore jika temp gagal dihapus */ }
  }

  const fileInfo = await stat(finalFile);
  const durationSec = Number((endSec - startSec).toFixed(2));

  return {
    clipPath: finalFile,
    durationSec,
    sizeBytes: fileInfo.size,
  };
}
