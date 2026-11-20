#!/usr/bin/env node
/**
 * Worker consumer: BRPOP dari list Redis `x7:jobs` lalu jalankan pipeline.
 * Job analyze_project: metadata -> transkrip -> chunk -> 9router -> validasi -> DB.
 */
import { pathToFileURL } from 'node:url';
import { loadEnv } from './env.js';
import { createDb } from './db.js';
import { getVideoMetadata, downloadTranscript } from './youtube.js';
import { parseTranscript } from './transcript.js';
import { chunkSegments } from './chunker.js';
import { selectClipsFromChunk } from './ninerouter.js';
import { validateClips, deduplicateClips } from './validator.js';

export const JOB_LIST = 'x7:jobs';
export const MAX_ATTEMPTS = 3;

export async function analyzeProject(job, { db, getMetadata, getTranscript, selectClips, requeue, log = () => {} }) {
  const project = await db.getProject(job.project_id);
  if (!project) {
    log(`project ${job.project_id} tidak ditemukan, job dibuang`);
    return { skipped: true };
  }

  try {
    const meta = await getMetadata(project.youtube_url);
    await db.markExtracting(project.id, { title: meta.title, durationSec: meta.duration_sec });

    const transcript = await getTranscript(project.youtube_url);
    const { segments, segmentMap } = parseTranscript(transcript.content);
    if (segments.length === 0) throw new Error('Transkrip kosong setelah parsing');
    await db.saveTranscript(project.id, segmentMap);

    await db.markAnalyzing(project.id);
    const chunks = chunkSegments(segments, meta.duration_sec);
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

    const clips = deduplicateClips(validateClips(rawClips, segmentMap, meta.duration_sec));
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

/** Dispatch berdasarkan job.type. */
export async function handleJob(job, deps) {
  if (job?.type === 'analyze_project') return analyzeProject(job, deps);
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

  const shutdown = async () => {
    log('shutdown...');
    await db.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`consumer siap, BRPOP ${JOB_LIST}`);
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

    log(`job ${job.type} project=${job.project_id} attempt=${job.attempt || 1}`);
    const result = await handleJob(job, {
      db,
      requeue,
      log,
      getMetadata: getVideoMetadata,
      getTranscript: downloadTranscript,
      selectClips: selectClipsFromChunk,
    });
    log(`hasil: ${JSON.stringify(result)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
