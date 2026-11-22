/**
 * Final render: trim -> crop/scale (16:9 atau 9:16 berbasis crop_x) -> burn-in ASS.
 * Semua posisi dalam rasio 0..1 supaya konsisten dengan preview browser.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toAss, assColour, assTime, subtitleLayout, sanitizeAssText } from './subtitleShift.js';
import { getFontNameFromFile, resolveFontName } from './fonts.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultOutputDir = resolve(projectRoot, 'storage/exports');
const defaultTempDir = resolve(projectRoot, 'storage/tmp');
const defaultFontsDir = resolve(projectRoot, 'storage/fonts');

const ALIGNMENT = { bottom: 2, middle: 5, top: 8 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seconds(value) {
  return Number(Number(value).toFixed(3));
}

/** Dimensi output; font ASS memakai PlayRes yang sama agar ukuran konsisten. */
export function outputDimensions(aspectRatio) {
  switch (aspectRatio) {
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:3':
      return { width: 1440, height: 1080 };
    case '16:9':
      return { width: 1920, height: 1080 };
    case '9:16':
    default:
      return { width: 1080, height: 1920 };
  }
}

/** Escape path untuk opsi filter FFmpeg (Windows: `C\:/dir/file.ass`). */
export function escapeFilterPath(path) {
  return String(path).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export function buildFilters({
  aspectRatio = '9:16',
  cropX = 0,
  layoutMode = 'crop',
  assPath = null,
  fontsDir = defaultFontsDir,
}) {
  const x = clamp(Number(cropX) || 0, 0, 1);
  const dims = outputDimensions(aspectRatio);
  const isBlur = layoutMode === 'blur' || layoutMode === 'blur_bg';

  let chain;
  if (isBlur) {
    chain = `[0:v]split=2[bg][fg];` +
      `[bg]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${dims.width}:${dims.height},gblur=sigma=35,eq=brightness=-0.12[bg_blur];` +
      `[fg]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease:flags=lanczos[fg_scaled];` +
      `[bg_blur][fg_scaled]overlay=(W-w)/2:(H-h)/2`;
  } else if (aspectRatio === '16:9') {
    chain = 'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2';
  } else if (aspectRatio === '1:1') {
    chain = `crop=w=ih:h=ih:x='trunc((iw-ih)*${x})':y=0,scale=1080:1080:flags=lanczos`;
  } else if (aspectRatio === '4:3') {
    chain = `crop=w='trunc(ih*2/3)*2':h=ih:x='trunc((iw-ih*4/3)*${x})':y=0,scale=1440:1080:flags=lanczos`;
  } else {
    // Default 9:16
    chain = `crop=w='trunc(ih*9/32)*2':h=ih:x='trunc((iw-ih*9/16)*${x})':y=0,scale=1080:1920:flags=lanczos`;
  }

  if (!assPath) return chain;
  const escapedAss = escapeFilterPath(assPath);
  const escapedFonts = fontsDir ? escapeFilterPath(fontsDir) : null;
  const subFilter = escapedFonts
    ? `subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}'`
    : `subtitles=filename='${escapedAss}'`;

  return `${chain},${subFilter}`;
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

export function parseCuts(config, durationSec) {
  if (Array.isArray(config.cuts) && config.cuts.length > 0) {
    const validCuts = config.cuts
      .filter((c) => c.active !== false)
      .map((c) => ({
        start: clamp(Number(c.start ?? 0), 0, durationSec),
        end: clamp(Number(c.end ?? durationSec), 0, durationSec),
      }))
      .filter((c) => c.end > c.start)
      .sort((a, b) => a.start - b.start);

    if (validCuts.length > 0) return validCuts;
  }
  const single = trimRange(config, durationSec);
  return [single];
}

export function trimRange(config, durationSec) {
  const start = clamp(Number(config.trim_start ?? 0), 0, Math.max(0, durationSec - 0.05));
  const end = clamp(Number(config.trim_end ?? durationSec), 0, durationSec);
  if (!(end > start)) throw new RangeError(`Rentang trim tidak valid: ${start}..${end}`);
  return { start: seconds(start), end: seconds(end) };
}

export function buildMultiCutFilter({ cuts, baseFilterString }) {
  const n = cuts.length;
  if (n <= 1) return baseFilterString;

  // Tiap segmen: trim video & audio
  const lines = [];
  const concatInputs = [];

  for (let i = 0; i < n; i++) {
    const { start, end } = cuts[i];
    lines.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    lines.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
    concatInputs.push(`[v${i}][a${i}]`);
  }

  lines.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=1[concatenated_v][concatenated_a]`);
  lines.push(`[concatenated_a]loudnorm=I=-14:TP=-1.5:LRA=11[outa]`);

  // Sambungkan visual processing (crop, blur, subtitle) ke concatenated_v
  let vProcess = baseFilterString;
  if (vProcess.startsWith('[0:v]')) {
    vProcess = vProcess.replace('[0:v]', '[concatenated_v]');
  } else {
    vProcess = `[concatenated_v]${vProcess}`;
  }
  lines.push(vProcess);

  return { filterComplex: lines.join(';'), hasAudioOut: true };
}

export function buildArgs({ rawClipPath, outputPath, config = {}, assPath = null, durationSec, fontsDir = defaultFontsDir }) {
  const cuts = parseCuts(config, durationSec);
  const baseFilter = buildFilters({
    aspectRatio: config.aspect_ratio,
    cropX: config.crop_x,
    layoutMode: config.layout_mode,
    assPath,
    fontsDir,
  });

  if (cuts.length > 1) {
    const multi = buildMultiCutFilter({ cuts, baseFilterString: baseFilter });
    return [
      '-y',
      '-i', rawClipPath,
      '-filter_complex', multi.filterComplex,
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-nostats',
      outputPath,
    ];
  }

  const { start, end } = cuts[0];
  const isComplex = baseFilter.includes(';') || baseFilter.includes('[');
  const filterFlag = isComplex ? '-filter_complex' : '-vf';

  return [
    '-y',
    '-ss', String(start),
    '-t', String(seconds(end - start)),
    '-i', rawClipPath,
    filterFlag, baseFilter,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
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
  const cuts = parseCuts(config, durationSec);
  const totalSec = seconds(cuts.reduce((sum, c) => sum + (c.end - c.start), 0));
  const subtitleConfig = config.subtitle ?? {};
  const hookConfig = config.hook_banner ?? {};
  const hookText = hookConfig.enabled && hookConfig.text ? sanitizeAssText(hookConfig.text).toUpperCase() : null;
  const useSubtitles = subtitleConfig.enabled !== false && subtitles.length > 0;
  const dims = outputDimensions(config.aspect_ratio);

  await makeDir(outputDir, { recursive: true });
  await makeDir(tempDir, { recursive: true });

  const outputPath = resolve(outputDir, `clip-${clip.id}-render-${renderJobId}.mp4`);
  const assPath = (useSubtitles || hookText) ? resolve(tempDir, `clip-${clip.id}-render-${renderJobId}.ass`) : null;

  if (assPath) {
    const position = config.subtitle_position ?? subtitleConfig.position ?? 'bottom';
    const layout = subtitleLayout(position, Boolean(hookText), dims.height);
    const offsetSec = clamp(Number(config.subtitle_offset_sec ?? subtitleConfig.offset_sec ?? 0) || 0, -2, 2);
    const rawFontSize = clamp(Number(config.subtitle_font_size ?? subtitleConfig.font_size ?? 64) || 64, 32, 96);
    const assFontSize = Math.round((dims.width / 1080) * rawFontSize);

    const activeSubtitles = (Array.isArray(config.edited_subtitles) && config.edited_subtitles.length > 0)
      ? config.edited_subtitles
      : (Array.isArray(config.subtitles) && config.subtitles.length > 0)
        ? config.subtitles
        : subtitles;

    const hookFontKey = config.hook_font || 'anton';
    const subtitleFontKey = config.subtitle_font || subtitleConfig.font_family || 'montserrat';
    const hookFontName = await getFontNameFromFile(hookFontKey, defaultFontsDir);
    const subtitleFontName = await getFontNameFromFile(subtitleFontKey, defaultFontsDir);

    const assContent = toAss(useSubtitles ? activeSubtitles : [], {
      fontName: process.env.SUBTITLE_FONT || subtitleFontName,
      bannerFontName: hookFontName,
      fontSize: assFontSize,
      alignment: layout.alignment,
      marginV: layout.marginV,
      offsetSec,
      bannerText: hookText,
      bannerDurationSec: totalSec,
      primaryColour: assColour(subtitleConfig.color),
      highlightColour: assColour(subtitleConfig.highlight_color || '#FFE600'),
      highlightKeywords: subtitleConfig.highlight_keywords || [],
      playResX: dims.width,
      playResY: dims.height,
    });

    await write(assPath, assContent);
  }

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
