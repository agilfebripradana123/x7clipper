#!/usr/bin/env node
/**
 * Worker consumer: BRPOP dari list Redis `x7:jobs` lalu jalankan pipeline.
 * Job analyze_project: metadata -> transkrip -> chunk -> 9router -> validasi -> DB.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
import { loadEnv } from './env.js';
import { createDb } from './db.js';
import { getVideoMetadata, downloadTranscript } from './youtube.js';
import { parseTranscript } from './transcript.js';
import { chunkSegments } from './chunker.js';
import { selectClipsFromChunk } from './ninerouter.js';
import { validateClips, deduplicateClips } from './validator.js';
import { detectJumpCuts } from './subtitleShift.js';

export const JOB_LIST = 'x7:jobs';
export const MAX_ATTEMPTS = 3;

/** Render FFmpeg dibatasi 1–2 job simultan per node (PRD non-fungsional). */
export function renderConcurrency(env = process.env) {
  const parsed = Number.parseInt(env.RENDER_CONCURRENCY, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(2, Math.max(1, parsed));
}

/** Antrean task dengan batas eksekusi paralel. */
export function createLimiter(limit) {
  const max = Math.max(1, limit);
  let active = 0;
  const pending = [];

  const pump = () => {
    while (active < max && pending.length > 0) {
      const { task, resolve, reject } = pending.shift();
      active++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return (task) => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject });
    pump();
  });
}

export async function analyzeProject(job, { db, getMetadata, getTranscript, selectClips, requeue, log = () => {} }) {
  const project = await db.getProject(job.project_id);
  if (!project) {
    log(`project ${job.project_id} tidak ditemukan, job dibuang`);
    return { skipped: true };
  }

  try {
    let title = project.video_title;
    let durationSec = 0;
    let rawTranscriptContent = '';

    if (job.source_type === 'upload' || project.source_type === 'upload') {
      const subPath = resolve(projectRoot, job.subtitle_path);
      rawTranscriptContent = await readFile(subPath, 'utf8');

      // Ambil durasi via ffprobe pada file video lokal
      const vidPath = resolve(projectRoot, job.video_path || project.local_video_path);
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
      const { stdout } = await execFileAsync(ffprobe, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        vidPath,
      ]);
      durationSec = Math.round(Number.parseFloat(stdout.trim()) || 0);
      await db.markExtracting(project.id, { title: title || 'Video Lokal', durationSec });
    } else {
      const meta = await getMetadata(project.youtube_url);
      title = meta.title;
      durationSec = meta.duration_sec;
      await db.markExtracting(project.id, { title, durationSec });

      const transcript = await getTranscript(project.youtube_url);
      rawTranscriptContent = transcript.content;
    }

    const { segments, segmentMap } = parseTranscript(rawTranscriptContent);
    if (segments.length === 0) throw new Error('Transkrip kosong setelah parsing');
    await db.saveTranscript(project.id, segmentMap);

    await db.markAnalyzing(project.id);
    const chunks = chunkSegments(segments, durationSec);
    const rawClips = [];
    let failedChunks = 0;
    let lastChunkError;
    for (const chunk of chunks) {
      try {
        const result = await selectClips(chunk.formattedText);
        if (Array.isArray(result?.clips)) rawClips.push(...result.clips);
      } catch (error) {
        failedChunks++;
        lastChunkError = error;
        log(`chunk ${chunk.chunkIndex} gagal, dilewati: ${error.message}`);
      }
    }
    // Semua chunk gagal = 9router/API bermasalah, jangan tandai ready dengan 0 klip.
    if (failedChunks === chunks.length) {
      throw new Error(`Semua ${chunks.length} chunk gagal dianalisis: ${lastChunkError.message}`);
    }

    const clips = deduplicateClips(validateClips(rawClips, segmentMap, durationSec));
    await db.saveClipsAndReady(project.id, clips);
    return { clips: clips.length, chunks: chunks.length };
  } catch (error) {
    const attempt = Number(job.attempt || 1);
    if (attempt < MAX_ATTEMPTS) {
      await db.markQueued(project.id, error.message);
      await requeue({ ...job, attempt: attempt + 1 });
      return { retried: true, error: error.message };
    }
    await db.failProject(project.id, error.message);
    return { failed: true, error: error.message };
  }
}

/**
 * Job prepare_clip: potong segmen via yt-dlp + FFmpeg, geser subtitle ke 00:00,
 * simpan raw_clip_path + subtitle_json. Idempoten, tidak pernah throw keluar.
 */
export async function prepareClip(job, { db, clipSegment, clipLocalFile, shiftSubtitles, fileExists, log = () => {} }) {
  if (!job?.clip_id) return { skipped: true };

  const clip = await db.getClip(job.clip_id);
  if (!clip) {
    log(`clip ${job.clip_id} tidak ditemukan, job dibuang`);
    return { skipped: true };
  }

  // Idempoten: sudah pernah dipotong dan file masih ada -> cukup tandai ready.
  if (clip.raw_clip_path && await fileExists(clip.raw_clip_path)) {
    await db.markClipReady(clip.id, { rawClipPath: clip.raw_clip_path });
    return { skipped: true };
  }

  const project = await db.getProject(clip.project_id);
  if (!project) {
    log(`project ${clip.project_id} tidak ditemukan, job dibuang`);
    return { skipped: true };
  }

  try {
    await db.markClipPreparing(clip.id);
    const segmentMap = await db.getProjectTranscript(clip.project_id);
    // Pecah ke format subtitle viral pendek (2-3 kata per baris)
    const subtitles = shiftSubtitles(Object.values(segmentMap ?? {}), clip.start_sec, clip.end_sec, { viral: true, maxWords: 3 });

    // Auto Jump-Cut: deteksi jeda hening > 1.2 detik dan siapkan cuts aktif
    const clipDur = Number(clip.end_sec) - Number(clip.start_sec);
    const autoCuts = detectJumpCuts(subtitles, clipDur, { minGapSec: 1.2, bufferSec: 0.15 });

    const currentConfig = clip.edit_config_json ?? {};
    const updatedConfig = {
      ...currentConfig,
      cuts: currentConfig.cuts && currentConfig.cuts.length > 0 ? currentConfig.cuts : autoCuts,
      trim_start: 0,
      trim_end: Number(clipDur.toFixed(3)),
    };

    // Upload lokal: potong langsung dari file video lokal via FFmpeg, tanpa yt-dlp.
    const isLocalUpload = project.source_type === 'upload' && project.local_video_path;
    let clipPath;
    if (isLocalUpload) {
      const videoAbsPath = resolve(projectRoot, project.local_video_path);
      ({ clipPath } = await clipLocalFile(videoAbsPath, clip.start_sec, clip.end_sec, {
        clipId: `clip-${clip.id}`,
      }));
    } else {
      ({ clipPath } = await clipSegment(project.youtube_url, clip.start_sec, clip.end_sec, {
        clipId: `clip-${clip.id}`,
      }));
    }

    await db.markClipReady(clip.id, { rawClipPath: clipPath, subtitles, editConfig: updatedConfig });
    return { clipId: clip.id, clipPath, subtitles: subtitles.length };
  } catch (error) {
    try { await db.markClipFailed(clip.id, error.message); } catch { /* DB gagal pun jangan crash consumer */ }
    log(`prepare clip ${clip.id} gagal: ${error.message}`);
    return { failed: true, error: error.message };
  }
}

/**
 * Job render_clip: FFmpeg trim + crop + burn-in subtitle, update progres ke DB.
 * Gagal render tidak boleh crash consumer.
 */
export async function renderClipJob(job, { db, render, fileExists, log = () => {} }) {
  if (!job?.render_job_id) return { skipped: true };

  const renderJob = await db.getRenderJob(job.render_job_id);
  if (!renderJob) {
    log(`render job ${job.render_job_id} tidak ditemukan, job dibuang`);
    return { skipped: true };
  }
  if (renderJob.status === 'done' || renderJob.status === 'failed') {
    return { skipped: true };
  }

  try {
    const clip = await db.getClip(renderJob.clip_id);
    if (!clip) throw new Error(`clip ${renderJob.clip_id} tidak ditemukan`);
    if (!clip.raw_clip_path || !(await fileExists(clip.raw_clip_path))) {
      throw new Error('File klip mentah belum tersedia');
    }

    await db.markRenderStarted(renderJob.id);

    let lastPercent = 0;
    const result = await render({
      clip,
      renderJobId: renderJob.id,
      config: clip.edit_config_json ?? {},
      subtitles: clip.subtitle_json ?? [],
      onProgress: async (percent) => {
        if (percent < 100 && percent - lastPercent < 5) return;
        lastPercent = percent;
        try {
          await db.updateRenderProgress(renderJob.id, percent);
        } catch { /* progres non-fatal, render tetap jalan */ }
      },
    });

    await db.markRenderDone(renderJob.id, result.outputUrl);
    return { renderJobId: renderJob.id, outputUrl: result.outputUrl };
  } catch (error) {
    try { await db.markRenderFailed(renderJob.id, error.message); } catch { /* DB gagal pun jangan crash */ }
    log(`render job ${renderJob.id} gagal: ${error.message}`);
    return { failed: true, error: error.message };
  }
}

/** Dispatch berdasarkan job.type. */
export async function handleJob(job, deps) {
  if (job?.type === 'analyze_project') return analyzeProject(job, deps);
  if (job?.type === 'prepare_clip') return prepareClip(job, deps);
  if (job?.type === 'render_clip') return renderClipJob(job, deps);
  deps.log?.(`tipe job tidak dikenal: ${job?.type}`);
  return { ignored: true };
}

async function main() {
  await loadEnv();
  const { default: Redis } = await import('ioredis');

  const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
  const db = createDb();
  const log = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
  const requeue = (job) => redis.lpush(JOB_LIST, JSON.stringify(job));

  const [{ clipSegment, clipLocalFile }, { shiftSubtitles, detectJumpCuts }, { renderClip }, { access }] = await Promise.all([
    import('./clipper.js'),
    import('./subtitleShift.js'),
    import('./renderer.js'),
    import('node:fs/promises'),
  ]);
  const fileExists = async (path) => {
    try { await access(path); return true; } catch { return false; }
  };

  const deps = {
    db,
    requeue,
    log,
    getMetadata: getVideoMetadata,
    getTranscript: downloadTranscript,
    selectClips: selectClipsFromChunk,
    clipSegment,
    clipLocalFile,
    shiftSubtitles,
    render: renderClip,
    fileExists,
  };

  const renderLimit = createLimiter(renderConcurrency());
  const inFlight = new Set();

  const runJob = async (job) => {
    log(`job ${job.type} project=${job.project_id ?? '-'} clip=${job.clip_id ?? '-'} attempt=${job.attempt || 1}`);
    try {
      const result = await handleJob(job, deps);
      log(`hasil: ${JSON.stringify(result)}`);
    } catch (error) {
      log(`job ${job.type} error tak terduga: ${error.message}`);
    }
  };

  const shutdown = async () => {
    if (inFlight.size > 0) log(`menunggu ${inFlight.size} render aktif selesai...`);
    await Promise.allSettled([...inFlight]);
    log('shutdown...');
    await db.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`consumer siap, BRPOP ${JOB_LIST} (render concurrency ${renderConcurrency()})`);
  for (;;) {
    const item = await redis.brpop(JOB_LIST, 0);
    if (!item) continue;

    let job;
    try {
      job = JSON.parse(item[1]);
    } catch {
      log(`payload bukan JSON, dibuang: ${item[1]}`);
      continue;
    }

    if (job?.type === 'render_clip') {
      // Render berat: jalankan paralel terbatas, jangan blok job analisis/prepare.
      const tracked = renderLimit(() => runJob(job)).finally(() => inFlight.delete(tracked));
      inFlight.add(tracked);
      continue;
    }

    await runJob(job);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
