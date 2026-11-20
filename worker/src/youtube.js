import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const YT_URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/;
const LANGUAGES = ['id', 'en'];

export class InvalidUrlError extends Error { constructor(url) { super(`URL YouTube tidak valid: ${url}`); this.name = 'InvalidUrlError'; } }
export class VideoTooShortError extends Error { constructor(sec) { super(`Video terlalu pendek: ${sec}s (min 60s)`); this.name = 'VideoTooShortError'; } }
export class TranscriptNotFoundError extends Error { constructor(id) { super(`Transkrip tidak ditemukan untuk video ${id}`); this.name = 'TranscriptNotFoundError'; } }
export class YtDlpError extends Error { constructor(msg) { super(msg); this.name = 'YtDlpError'; } }

function videoIdFromUrl(url) {
  const match = url.match(YT_URL_RE);
  if (!match) throw new InvalidUrlError(url);
  return match[1];
}

async function runYtDlp(args, run = execFileAsync) {
  try {
    return await run(process.env.YTDLP_PATH || 'yt-dlp', args, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    throw new YtDlpError(error.stderr || error.message);
  }
}

/** Ambil metadata video YouTube. */
export async function getVideoMetadata(url, { run = execFileAsync } = {}) {
  videoIdFromUrl(url);
  const { stdout } = await runYtDlp(['--dump-json', '--no-playlist', url], run);
  let info;
  try { info = JSON.parse(stdout); } catch { throw new YtDlpError('yt-dlp mengembalikan metadata JSON tidak valid'); }

  const duration_sec = Math.round(info.duration || 0);
  if (duration_sec < 60) throw new VideoTooShortError(duration_sec);
  return {
    id: info.id,
    title: info.title || info.fulltitle || '',
    duration_sec,
    thumbnail_url: info.thumbnail || '',
    subtitles_available: [...Object.keys(info.subtitles || {}), ...Object.keys(info.automatic_captions || {}).map((lang) => `auto:${lang}`)],
  };
}

/** Download satu transkrip VTT. Prioritas: manual id/en, lalu auto id/en. */
export async function downloadTranscript(url, { transcriptsDir = process.env.STORAGE_TRANSCRIPTS || './storage/transcripts', run = execFileAsync, read = readFile, makeDir = mkdir } = {}) {
  const videoId = videoIdFromUrl(url);
  const { stdout } = await runYtDlp(['--dump-json', '--no-playlist', url], run);
  let info;
  try { info = JSON.parse(stdout); } catch { throw new YtDlpError('yt-dlp mengembalikan metadata JSON tidak valid'); }

  const manualLang = LANGUAGES.find((lang) => info.subtitles?.[lang]);
  const autoLang = LANGUAGES.find((lang) => info.automatic_captions?.[lang]);
  const lang = manualLang || autoLang;
  if (!lang) throw new TranscriptNotFoundError(videoId);

  const auto = !manualLang;
  const outDir = resolve(transcriptsDir);
  await makeDir(outDir, { recursive: true });
  await runYtDlp([
    '--skip-download', auto ? '--write-auto-sub' : '--write-sub', '--sub-lang', lang,
    '--sub-format', 'vtt', '--no-playlist', '-o', resolve(outDir, '%(id)s.%(ext)s'), url,
  ], run);

  const filePath = resolve(outDir, `${videoId}.${lang}.vtt`);
  try {
    return { filePath, content: await read(filePath, 'utf-8'), lang, auto };
  } catch (error) {
    if (error.code === 'ENOENT') throw new TranscriptNotFoundError(videoId);
    throw error;
  }
}
