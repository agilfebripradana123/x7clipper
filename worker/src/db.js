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
      const rows = await query('SELECT id, youtube_url, status FROM projects WHERE id = ?', [id]);
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

    async close() {
      if (!poolPromise) return;
      const pool = await poolPromise;
      await pool.end();
    },
  };
}
