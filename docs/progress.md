# Log Progres Proyek Web Clipper

Dokumentasi jejak eksekusi setiap fase sesuai spesifikasi `PRD.md` dan panduan `AGENTS.md`.

---

## [2026-11-20] Inisialisasi Struktur Direktori & Git Ignore (Fase 0 - Item 1)
- **Tujuan:** Menyiapkan struktur direktori dasar proyek dan konfigurasi `.gitignore`.
- **Direktori dibuat:**
  - `backend/` — API REST & Queue Dispatcher (Laravel/Node).
  - `worker/` — Worker processing (yt-dlp, subtitle parser, FFmpeg, 9router client).
  - `frontend/` — Web video editor UI (React + Vite + Tailwind).
  - `storage/tmp/` — File unduhan dan segment temporal.
  - `storage/transcripts/` — Cache subtitle/transkrip JSON.
  - `storage/raw-clips/` — Video clip potongan parsial.
  - `storage/exports/` — Hasil final render FFmpeg.
  - `docs/` — Dokumentasi progres per iterasi.
- **File ditambahkan:**
  - `.gitignore` (abaikan dependensi, environment file, dan isi storage sementara).
  - `.gitkeep` di setiap direktori kosong.
- **Status:** Selesai.

## [2026-11-20] Template Environment (Fase 0 - Item 2)
- **Tujuan:** Mendokumentasikan konfigurasi layanan dan binary eksternal tanpa menyimpan secret.
- **File ditambahkan:** `.env.example`.
- **Variabel:** 9router, Redis, MySQL, `yt-dlp`, FFmpeg, ffprobe, path storage, API port, dan konkurensi worker.
- **Status:** Selesai.

## [2026-11-20] Healthcheck Script (Fase 0 - Item 3)
- **Tujuan:** Script verifikasi kesiapan binary eksternal, Redis, dan 9router.
- **File ditambahkan:** `worker/scripts/healthcheck.js`, `worker/package.json` (deps: `ioredis`, `zod`).
- **Hasil uji:**
  - `yt-dlp` — FAIL (belum install di PATH)
  - `ffmpeg` — FAIL (belum install di PATH)
  - `ffprobe` — FAIL (belum install di PATH)
  - `Redis` — PASS (PONG ke `127.0.0.1:6379`)
  - `9router config` — FAIL (belum diset di `.env`)
- **Blocker:** Perlu install `yt-dlp` dan `ffmpeg` di PATH host sebelum Fase 1 uji riil.
- **Status:** Selesai (Fase 0 tuntas).

## [2026-11-20] Modul YouTube (Fase 1 - Item 1)
- **Tujuan:** Ambil metadata YouTube dan unduh subtitle VTT tanpa video penuh.
- **File ditambahkan:** `worker/src/youtube.js`, `worker/test/youtube.test.js`.
- **Kontrak:**
  - `getVideoMetadata(url)` validasi URL YouTube, panggil `yt-dlp --dump-json --no-playlist`, dan tolak video < 60 detik.
  - `downloadTranscript(url)` pilih subtitle manual `id`/`en`, fallback auto-caption, unduh VTT saja via `--skip-download`.
  - Error eksplisit: `InvalidUrlError`, `VideoTooShortError`, `TranscriptNotFoundError`, `YtDlpError`.
- **Hasil uji:** `node --test test/youtube.test.js` — PASS 6/6.
- **Status:** Selesai.

