/**
 * Satu-satunya modul yang menyentuh MySQL.
 * Kalau worker dipindah ke VPS terpisah, ganti isi modul ini dengan HTTP callback.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function dbConfigFromEnv(env = process.env) {
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USERNAME || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_DATABASE || 'x7clip',
  };
}

/** Kolom JSON: stringify object/array, null tetap SQL NULL. */
export function jsonOrNull(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** Kolom JSON dari DB bisa string (MariaDB) atau object (driver lain). */
function parseJson(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export const CLIP_INSERT_SQL = `INSERT INTO clips
  (project_id, title, start_sec, end_sec, viral_score, hook_type, ai_reason, suggested_caption, subtitle_json, edit_config_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;

export function toClipParams(projectId, clip) {
  return [
    projectId,
    clip.title,
    Number(clip.start_sec),
    Number(clip.end_sec),
    Number(clip.viral_score),
    clip.hook_type,
    clip.reason ?? clip.ai_reason ?? null,
    clip.suggested_caption ?? null,
    jsonOrNull(clip.subtitle_json),
    jsonOrNull(clip.edit_config_json),
  ];
}

export function createDb({ config = dbConfigFromEnv(), createPool } = {}) {
  let poolPromise;

  function getPool() {
    if (!poolPromise) {
      poolPromise = (async () => {
        const factory = createPool ? { createPool } : await import('mysql2/promise');
        return factory.createPool({
          ...config,
          charset: 'UTF8MB4_UNICODE_CI',
          waitForConnections: true,
          connectionLimit: 4,
        });
      })();
    }
    return poolPromise;
  }

  async function query(sql, params = []) {
    const pool = await getPool();
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  const setStatus = (status) =>
    async (id, message = null) =>
      query('UPDATE projects SET status = ?, error_message = ?, updated_at = NOW() WHERE id = ?', [status, message, id]);

  return {
    async getProject(id) {
      const rows = await query('SELECT id, source_type, youtube_url, local_video_path, video_title, status FROM projects WHERE id = ?', [id]);
      return rows[0] ?? null;
    },

    async markExtracting(id, { title, durationSec } = {}) {
      await query(
        'UPDATE projects SET status = ?, video_title = ?, duration_sec = ?, error_message = NULL, updated_at = NOW() WHERE id = ?',
        ['extracting', title ?? null, durationSec ?? null, id],
      );
    },

    async saveTranscript(id, segmentMap) {
      await query('UPDATE projects SET transcript_segments_json = ?, updated_at = NOW() WHERE id = ?', [jsonOrNull(segmentMap), id]);
    },

    /** segmentMap dari projects.transcript_segments_json; null jika kosong. */
    async getProjectTranscript(id) {
      const rows = await query('SELECT transcript_segments_json FROM projects WHERE id = ?', [id]);
      const raw = rows[0]?.transcript_segments_json;
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },

    async getClip(id) {
      const rows = await query(
        'SELECT id, project_id, start_sec, end_sec, raw_clip_path, prepare_status, subtitle_json, edit_config_json FROM clips WHERE id = ?',
        [id],
      );
      const clip = rows[0];
      if (!clip) return null;
      return {
        ...clip,
        id: Number(clip.id),
        project_id: Number(clip.project_id),
        start_sec: Number(clip.start_sec),
        end_sec: Number(clip.end_sec),
        subtitle_json: parseJson(clip.subtitle_json),
        edit_config_json: parseJson(clip.edit_config_json),
      };
    },

    async markClipPreparing(id) {
      await query("UPDATE clips SET prepare_status = 'preparing', prepare_error = NULL, updated_at = NOW() WHERE id = ?", [id]);
    },

    /** subtitle_json hanya ditimpa bila `subtitles` diberikan (jalur idempoten aman). */
    async markClipReady(id, { rawClipPath, subtitles } = {}) {
      await query(
        'UPDATE clips SET prepare_status = ?, prepare_error = NULL, raw_clip_path = ?, subtitle_json = COALESCE(?, subtitle_json), updated_at = NOW() WHERE id = ?',
        ['ready', rawClipPath ?? null, jsonOrNull(subtitles), id],
      );
    },

    async markClipFailed(id, message) {
      await query("UPDATE clips SET prepare_status = 'failed', prepare_error = ?, updated_at = NOW() WHERE id = ?", [message, id]);
    },

    markAnalyzing: setStatus('analyzing'),
    markQueued: setStatus('queued'),
    failProject: setStatus('failed'),

    /** Insert klip + tandai project ready dalam satu transaksi. */
    async saveClipsAndReady(id, clips) {
      const pool = await getPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute('DELETE FROM clips WHERE project_id = ?', [id]);
        for (const clip of clips) {
          await conn.execute(CLIP_INSERT_SQL, toClipParams(id, clip));
        }
        await conn.execute("UPDATE projects SET status = 'ready', error_message = NULL, updated_at = NOW() WHERE id = ?", [id]);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    },

    async getRenderJob(id) {
      const rows = await query('SELECT id, clip_id, status, progress_percent FROM render_jobs WHERE id = ?', [id]);
      const job = rows[0];
      if (!job) return null;
      return {
        ...job,
        id: Number(job.id),
        clip_id: Number(job.clip_id),
        progress_percent: Number(job.progress_percent),
      };
    },

    async markRenderStarted(id) {
      await query("UPDATE render_jobs SET status = 'rendering', progress_percent = 0, error_message = NULL, updated_at = NOW() WHERE id = ?", [id]);
    },

    async updateRenderProgress(id, percent) {
      await query(
        'UPDATE render_jobs SET progress_percent = ?, updated_at = NOW() WHERE id = ?',
        [Math.max(0, Math.min(100, Math.round(percent))), id],
      );
    },

    async markRenderDone(id, outputUrl) {
      await query(
        "UPDATE render_jobs SET status = 'done', progress_percent = 100, output_url = ?, error_message = NULL, updated_at = NOW() WHERE id = ?",
        [outputUrl, id],
      );
    },

    async markRenderFailed(id, message) {
      await query(
        "UPDATE render_jobs SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?",
        [message, id],
      );
    },

    async close() {
      if (!poolPromise) return;
      const pool = await poolPromise;
      await pool.end();
    },
  };
}
