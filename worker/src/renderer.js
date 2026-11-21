/**
 * Final render: trim -> crop/scale (16:9 atau 9:16 berbasis crop_x) -> burn-in ASS.
 * Semua posisi dalam rasio 0..1 supaya konsisten dengan preview browser.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toAss, assColour } from './subtitleShift.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultOutputDir = resolve(projectRoot, 'storage/exports');
const defaultTempDir = resolve(projectRoot, 'storage/tmp');

const ALIGNMENT = { bottom: 2, middle: 5, top: 8 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seconds(value) {
  return Number(Number(value).toFixed(3));
}

/** Dimensi output; font ASS memakai PlayRes yang sama agar ukuran konsisten. */
export function outputDimensions(aspectRatio) {
  return aspectRatio === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
}

/** Escape path untuk opsi filter FFmpeg (Windows: `C\:/dir/file.ass`). */
export function escapeFilterPath(path) {
  return String(path).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export function buildFilters({ aspectRatio = '16:9', cropX = 0, assPath = null }) {
  const isVertical = aspectRatio === '9:16';
  const x = clamp(Number(cropX) || 0, 0, 1);
  const chain = isVertical
    ? `crop=w='trunc(ih*9/32)*2':h=ih:x='trunc((iw-ih*9/16)*${x})':y=0,scale=${outputDimensions(aspectRatio).width}:${outputDimensions(aspectRatio).height}`
    : 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2';

  return assPath ? `${chain},subtitles=filename='${escapeFilterPath(assPath)}'` : chain;
}

/** Baris `-progress pipe:1` FFmpeg -> persen 0..100 (null kalau bukan baris progres). */
export function parseProgressPercent(line, durationSec) {
  if (!(durationSec > 0)) return null;
  const text = String(line).trim();

  const micros = /^out_time_(?:ms|us)=(\d+)$/.exec(text);
  if (micros) return clamp(Math.round((Number(micros[1]) / 1_000_000 / durationSec) * 100), 0, 100);

  const clock = /^out_time=(\d+):(\d{2}):(\d+(?:\.\d+)?)$/.exec(text);
  if (clock) {
    const sec = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    return clamp(Math.round((sec / durationSec) * 100), 0, 100);
  }

  return null;
}

export function trimRange(config, durationSec) {
  const start = clamp(Number(config.trim_start ?? 0), 0, Math.max(0, durationSec - 0.05));
  const end = clamp(Number(config.trim_end ?? durationSec), 0, durationSec);
  if (!(end > start)) throw new RangeError(`Rentang trim tidak valid: ${start}..${end}`);
  return { start: seconds(start), end: seconds(end) };
}

export function buildArgs({ rawClipPath, outputPath, config = {}, assPath = null, durationSec }) {
  const { start, end } = trimRange(config, durationSec);

  return [
    '-y',
    '-ss', String(start),
    '-t', String(seconds(end - start)),
    '-i', rawClipPath,
    '-vf', buildFilters({ aspectRatio: config.aspect_ratio, cropX: config.crop_x, assPath }),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath,
  ];
}

function runFfmpeg(ffmpeg, args, { spawnFn = spawn, totalSec, onProgress = () => {} }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnFn(ffmpeg, args);
    let stderrTail = '';
    let buffer = '';

    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const percent = parseProgressPercent(line, totalSec);
        if (percent !== null) onProgress(percent);
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`FFmpeg gagal (exit ${code}): ${stderrTail.trim().split(/\r?\n/).pop() ?? 'tanpa pesan'}`));
    });
  });
}

export async function renderClip({
  clip,
  renderJobId,
  config = {},
  subtitles = [],
  outputDir = defaultOutputDir,
  tempDir = defaultTempDir,
  ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
  spawnFn = spawn,
  onProgress,
  makeDir = mkdir,
  write = writeFile,
  remove = unlink,
} = {}) {
  if (!clip?.raw_clip_path) throw new Error('raw_clip_path belum tersedia');

  const durationSec = seconds(Number(clip.end_sec) - Number(clip.start_sec));
  const { start, end } = trimRange(config, durationSec);
  const subtitleConfig = config.subtitle ?? {};
  const useSubtitles = subtitleConfig.enabled !== false && subtitles.length > 0;
  const dims = outputDimensions(config.aspect_ratio);

  await makeDir(outputDir, { recursive: true });
  await makeDir(tempDir, { recursive: true });

  const outputPath = resolve(outputDir, `clip-${clip.id}-render-${renderJobId}.mp4`);
  const assPath = useSubtitles ? resolve(tempDir, `clip-${clip.id}-render-${renderJobId}.ass`) : null;

  if (assPath) {
    await write(assPath, toAss(subtitles, {
      fontName: process.env.SUBTITLE_FONT || 'Arial',
      fontSize: subtitleConfig.font_size ?? 42,
      alignment: ALIGNMENT[subtitleConfig.position] ?? 2,
      primaryColour: assColour(subtitleConfig.color),
      playResX: dims.width,
      playResY: dims.height,
    }));
  }

  const totalSec = seconds(end - start);
  const args = buildArgs({ rawClipPath: clip.raw_clip_path, outputPath, config, assPath, durationSec });

  try {
    await runFfmpeg(ffmpeg, args, { spawnFn, totalSec, onProgress });
  } finally {
    if (assPath) {
      try { await remove(assPath); } catch { /* temp boleh tertinggal */ }
    }
  }

  return {
    outputPath,
    outputUrl: relative(projectRoot, outputPath).split('\\').join('/'),
    durationSec: totalSec,
  };
}
