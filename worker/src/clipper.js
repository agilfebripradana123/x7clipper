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
 * Parse output silencedetect dari FFmpeg stderr ke array rentang jeda hening [{ start, end }].
 */
export function parseSilencesFromStderr(stderr) {
  const silences = [];
  const lines = String(stderr || '').split(/\r?\n/);
  let curStart = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (startMatch) {
      curStart = parseFloat(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (endMatch && curStart !== null) {
      const end = parseFloat(endMatch[1]);
      silences.push({ start: curStart, end });
      curStart = null;
    }
  }

  return silences;
}

/**
 * Snap batas target awal & akhir klip ke celah hening bicara terdekat.
 *
 * @param {string} videoPath
 * @param {number} targetStartOffset Offset relatif target mulai di video input
 * @param {number} targetEndOffset Offset relatif target selesai di video input
 * @param {object} options
 * @returns {Promise<{ actualStartOffset: number, actualEndOffset: number }>}
 */
export async function snapBoundariesToSilence(videoPath, targetStartOffset, targetEndOffset, {
  ffmpeg = bin('FFMPEG_PATH', 'ffmpeg'),
  run = execFileAsync,
  noiseThreshold = '-35dB',
  minDuration = 0.20,
} = {}) {
  // Jalankan silencedetect FFmpeg
  let stderr = '';
  try {
    const res = await run(ffmpeg, [
      '-y',
      '-i', videoPath,
      '-af', `silencedetect=noise=${noiseThreshold}:d=${minDuration}`,
      '-f', 'null',
      '-',
    ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    stderr = res.stderr || '';
  } catch (err) {
    stderr = err?.stderr || '';
  }

  const silences = parseSilencesFromStderr(stderr);

  // 1. Start Snap: cari jeda hening dalam jendela [-1.5s, +0.4s] dari targetStartOffset
  let actualStart = Math.max(0, targetStartOffset - 0.25);
  const startCandidates = silences.filter((s) => s.end >= targetStartOffset - 1.5 && s.end <= targetStartOffset + 0.4);

  if (startCandidates.length > 0) {
    // Pilih celah yang silence.end paling dekat dengan targetStartOffset
    startCandidates.sort((a, b) => Math.abs(a.end - targetStartOffset) - Math.abs(b.end - targetStartOffset));
    const best = startCandidates[0];
    actualStart = Math.max(0, Number((best.end - 0.15).toFixed(3)));
  }

  // 2. End Snap: cari jeda hening dalam jendela [-0.2s, +2.5s] dari targetEndOffset
  let actualEnd = Number((targetEndOffset + 0.50).toFixed(3));
  const endCandidates = silences.filter((s) => s.start >= targetEndOffset - 0.2 && s.start <= targetEndOffset + 2.5);

  if (endCandidates.length > 0) {
    endCandidates.sort((a, b) => Math.abs(a.start - targetEndOffset) - Math.abs(b.start - targetEndOffset));
    const best = endCandidates[0];
    actualEnd = Number((best.start + 0.35).toFixed(3));
  }

  if (actualEnd <= actualStart) {
    actualEnd = Number((actualStart + Math.max(3, targetEndOffset - targetStartOffset)).toFixed(3));
  }

  return {
    actualStartOffset: Number(actualStart.toFixed(3)),
    actualEndOffset: Number(actualEnd.toFixed(3)),
  };
}

/**
 * Potong file video lokal langsung menggunakan FFmpeg tanpa yt-dlp.
 */
export async function clipLocalFile(inputPath, startSec, endSec, {
  clipId = randomUUID(),
  outputDir = defaultOutputDir,
  tempDir = defaultTempDir,
  videoDuration = null,
  enableSilenceSnap = true,
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

  await makeDir(outputDir, { recursive: true });
  await makeDir(tempDir, { recursive: true });

  const finalFile = resolve(outputDir, `${clipId}.mp4`);

  if (!enableSilenceSnap) {
    const durationSec = Number((endSec - startSec).toFixed(3));
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
      actualStartSec: startSec,
      actualEndSec: endSec,
      durationSec,
      sizeBytes: fileInfo.size,
    };
  }

  // Ambil buffer rentang sementara dengan bantalan: padBefore = 2.0s, padAfter = 3.0s
  const maxDur = typeof videoDuration === 'number' && videoDuration > 0 ? videoDuration : endSec + 5.0;
  const padBefore = Math.min(2.0, startSec);
  const padAfter = Math.min(3.0, Math.max(0, maxDur - endSec));

  const extractStart = Math.max(0, Number((startSec - padBefore).toFixed(3)));
  const extractEnd = Math.min(maxDur, Number((endSec + padAfter).toFixed(3)));
  const extractDur = Number((extractEnd - extractStart).toFixed(3));

  const paddedTemp = resolve(tempDir, `padded-${clipId}.mp4`);

  try {
    await run(ffmpeg, [
      '-y',
      '-ss', String(extractStart),
      '-t', String(extractDur),
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      paddedTemp,
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

    const targetStartOffset = Number((startSec - extractStart).toFixed(3));
    const targetEndOffset = Number((endSec - extractStart).toFixed(3));

    const { actualStartOffset, actualEndOffset } = await snapBoundariesToSilence(
      paddedTemp,
      targetStartOffset,
      targetEndOffset,
      { ffmpeg, run }
    );

    const actualStartSec = Number((extractStart + actualStartOffset).toFixed(3));
    const actualEndSec = Number((extractStart + actualEndOffset).toFixed(3));
    const durationSec = Number((actualEndSec - actualStartSec).toFixed(3));

    await run(ffmpeg, [
      '-y',
      '-ss', String(actualStartOffset),
      '-t', String(durationSec),
      '-i', paddedTemp,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      finalFile,
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

    const fileInfo = await stat(finalFile);
    return {
      clipPath: finalFile,
      actualStartSec,
      actualEndSec,
      durationSec,
      sizeBytes: fileInfo.size,
    };
  } finally {
    try { await unlink(paddedTemp); } catch { /* ignore */ }
  }
}

/**
 * Download potongan segmen parsial via yt-dlp --download-sections
 * lalu rapikan keyframe dan snap celah hening bicara via FFmpeg
 * agar awal kalimat tidak terpotong dan akhir kalimat selesai tuntas.
 */
export async function clipSegment(url, startSec, endSec, {
  clipId = randomUUID(),
  tempDir = defaultTempDir,
  outputDir = defaultOutputDir,
  videoDuration = null,
  enableSilenceSnap = true,
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

  const finalFile = resolve(outputDir, `${clipId}.mp4`);

  if (!enableSilenceSnap) {
    const tempFile = resolve(tempDir, `temp-${clipId}.mp4`);
    const sectionSpec = `*${startSec}-${endSec}`;

    const ytdlpArgs = [
      '--download-sections', sectionSpec,
      '--force-keyframes-at-cuts',
      '--ffmpeg-location', dirname(ffmpeg),
      '--no-playlist',
      '--retries', '5',
      '--fragment-retries', '5',
      '-f', 'bv*[vcodec^=avc1][height<=1440]+ba[ext=m4a]/bv*[ext=mp4][height<=1440]+ba[ext=m4a]/bv*[height<=1440]+ba/b[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', tempFile,
      url,
    ];

    await run(ytdlp, ytdlpArgs, { timeout: 360_000, maxBuffer: 20 * 1024 * 1024 });

    const ffmpegArgs = [
      '-y',
      '-avoid_negative_ts', 'make_zero',
      '-i', tempFile,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      finalFile,
    ];

    try {
      await run(ffmpeg, ffmpegArgs, { timeout: 240_000, maxBuffer: 20 * 1024 * 1024 });
    } finally {
      try { await unlink(tempFile); } catch { /* ignore */ }
    }

    const fileInfo = await stat(finalFile);
    const durationSec = Number((endSec - startSec).toFixed(3));

    return {
      clipPath: finalFile,
      actualStartSec: startSec,
      actualEndSec: endSec,
      durationSec,
      sizeBytes: fileInfo.size,
    };
  }

  // Download section dengan bantalan keamanan: padBefore = 2.0s, padAfter = 3.0s
  const maxDur = typeof videoDuration === 'number' && videoDuration > 0 ? videoDuration : endSec + 5.0;
  const padBefore = Math.min(2.0, startSec);
  const padAfter = Math.min(3.0, Math.max(0, maxDur - endSec));

  const extractStart = Math.max(0, Number((startSec - padBefore).toFixed(3)));
  const extractEnd = Math.min(maxDur, Number((endSec + padAfter).toFixed(3)));

  const paddedTemp = resolve(tempDir, `temp-${clipId}.mp4`);
  const sectionSpec = `*${extractStart}-${extractEnd}`;

  const ytdlpArgs = [
    '--download-sections', sectionSpec,
    '--force-keyframes-at-cuts',
    '--ffmpeg-location', dirname(ffmpeg),
    '--no-playlist',
    '--retries', '5',
    '--fragment-retries', '5',
    '-f', 'bv*[vcodec^=avc1][height<=1440]+ba[ext=m4a]/bv*[ext=mp4][height<=1440]+ba[ext=m4a]/bv*[height<=1440]+ba/b[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '-o', paddedTemp,
    url,
  ];

  await run(ytdlp, ytdlpArgs, { timeout: 360_000, maxBuffer: 20 * 1024 * 1024 });

  try {
    const targetStartOffset = Number((startSec - extractStart).toFixed(3));
    const targetEndOffset = Number((endSec - extractStart).toFixed(3));

    const { actualStartOffset, actualEndOffset } = await snapBoundariesToSilence(
      paddedTemp,
      targetStartOffset,
      targetEndOffset,
      { ffmpeg, run }
    );

    const actualStartSec = Number((extractStart + actualStartOffset).toFixed(3));
    const actualEndSec = Number((extractStart + actualEndOffset).toFixed(3));
    const durationSec = Number((actualEndSec - actualStartSec).toFixed(3));

    const ffmpegArgs = [
      '-y',
      '-ss', String(actualStartOffset),
      '-t', String(durationSec),
      '-i', paddedTemp,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      finalFile,
    ];

    await run(ffmpeg, ffmpegArgs, { timeout: 240_000, maxBuffer: 20 * 1024 * 1024 });
    const fileInfo = await stat(finalFile);

    return {
      clipPath: finalFile,
      actualStartSec,
      actualEndSec,
      durationSec,
      sizeBytes: fileInfo.size,
    };
  } finally {
    try { await unlink(paddedTemp); } catch { /* ignore */ }
  }
}
