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

## [2026-11-20] Parser & Normalizer Transkrip (Fase 1 - Item 2)
- **Tujuan:** Parse format VTT/SRT, bersihkan tag HTML/rolling captions, dan gabungkan cue menjadi segmen kalimat 6–10 detik `[S{id}|{detik}]` dengan `segmentMap`.
- **File ditambahkan:** `worker/src/transcript.js`, `worker/test/transcript.test.js`.
- **Kontrak:**
  - `parseTimestamp(str)` konversi format `HH:MM:SS.mmm` / `MM:SS.mmm` / koma SRT ke float detik.
  - `parseTranscript(text)` hasilkan `{ segments, segmentMap, formattedText }`.
  - Durasi segmen dibatasi 6–10 detik dengan pemenggalan tanda baca kalimat (`.`, `!`, `?`).
- **Hasil uji:** `node --test` — PASS 10/10 (4 test baru transkrip + 6 test youtube).
- **Status:** Selesai.

## [2026-11-20] Chunker Transkrip Sliding Window (Fase 1 - Item 3)
- **Tujuan:** Pecah transkrip panjang ke segmen analisis AI terstruktur.
- **File ditambahkan:** `worker/src/chunker.js`, `worker/test/chunker.test.js`.
- **Kontrak:**
  - `chunkSegments(segments, durationSec)`
  - Durasi < 20 menit (1200 detik): 1 request utuh.
  - Durasi >= 20 menit: sliding window 15 menit (900 detik) dengan overlap 2 menit (120 detik).
  - Mengembalikan array chunk yang masing-masing membawa `formattedText` dan segmen terkait.
- **Hasil uji:** `node --test` — PASS 14/14 (4 test baru chunker).
- **Status:** Selesai.

## [2026-11-20] Client 9router (Fase 1 - Item 4)
- **Tujuan:** Kirim transkrip chunk ke endpoint OpenAI-compatible 9router untuk seleksi momen klip.
- **File ditambahkan:** `worker/src/ninerouter.js`, `worker/test/ninerouter.test.js`.
- **Kontrak:**
  - `selectClipsFromChunk(formattedText, options)` kirim ke `/v1/chat/completions`.
  - Request wajib memakai `temperature: 0.2` dan `response_format: { type: "json_object" }`.
  - System prompt mewajibkan 1–4 momen, hook/penutup kuat, dan Segment-ID grounding.
  - `cleanJsonString()` menghapus markdown code fence/preamble dan retry 1x jika `JSON.parse()` gagal.
- **Hasil uji:** `npm test` — PASS 18/18 (4 test baru 9router).
- **Status:** Selesai.

## [2026-11-20] Validator & Deduplikasi Klip (Fase 1 - Item 5)
- **Tujuan:** Validasi skema Zod pada respons AI, grounding Segment-ID ke float timestamp, penambahan padding pengaman, dan deduplikasi klip.
- **File ditambahkan:** `worker/src/validator.js`, `worker/test/validator.test.js`.
- **Kontrak:**
  - `validateClips(rawClips, segmentMap, videoDuration)` validasi skema via Zod, resolve Segment-ID, tolak durasi < 15s atau > 110s, hitung padding `-0.35s` dan `+0.50s` (clamped).
  - `deduplicateClips(clips)` deteksi overlap > 50% dari durasi klip terpendek, simpan hanya yang memiliki `viral_score` tertinggi.
- **Hasil uji:** `npm test` — PASS 26/26 (8 test baru validator).
- **Status:** Selesai.

## [2026-11-20] Smart Clipper (Fase 2 - Item 1)
- **Tujuan:** Unduh potongan video parsial menggunakan `yt-dlp --download-sections` tanpa download full video, lalu rapikan keyframe dan faststart via FFmpeg.
- **File ditambahkan:** `worker/src/clipper.js`, `worker/test/clipper.test.js`.
- **Kontrak:**
  - `clipSegment(url, startSec, endSec, options)`
  - Panggil `yt-dlp --download-sections "*start-end" --force-keyframes-at-cuts --ffmpeg-location ...`
  - Re-encode via `ffmpeg -c:v libx264 -preset veryfast -c:a aac -movflags +faststart`
  - Bersihkan file temp, kembalikan `{ clipPath, durationSec, sizeBytes }`.
- **Hasil uji:**
  - Unit test `node --test`: PASS 29/29.
  - Uji riil: potong detik `10s–25s` dari YouTube langsung menghasilkan file MP4 1080p h264 + aac 15.00s (5.02 MB) di `storage/raw-clips/live-test-01.mp4`.
- **Status:** Selesai.

## [2026-11-20] Subtitle Shift & Export (Fase 2 - Item 2)
- **Tujuan:** Iris subtitle ke rentang klip dan geser timestamp agar klip selalu mulai dari `00:00`.
- **File ditambahkan:** `worker/src/subtitleShift.js`, `worker/test/subtitleShift.test.js`.
- **Kontrak:**
  - `shiftSubtitles(segments, startSec, endSec)` filter irisan, clamp batas subtitle, lalu geser timestamp mundur sebesar `startSec`.
  - `toSrt(subtitles)` menghasilkan standar SRT.
  - `toAss(subtitles, style)` menghasilkan ASS dasar kompatibel filter subtitles FFmpeg.
- **Hasil uji:** `npm test` — PASS 33/33; mencakup clamp awal/akhir dan serialisasi SRT/ASS.
- **Status:** Selesai.

## [2026-11-20] Verifikasi Pemutaran Klip MP4 & Sinkronisasi Audio/Subtitle (Fase 2 - Item 3)
- **Tujuan:** Memastikan klip `.mp4` parsial hasil smart clipping dapat diputar mulus di browser tanpa freeze di 2 detik awal serta audio sinkron dengan teks subtitle.
- **Metrik & Hasil Verifikasi:**
  - File klip riil: `storage/raw-clips/podcast-clip-01.mp4` (durasi 37.65s, 9.62 MB).
  - Stream audio: start time `0.000000` (AAC).
  - Stream video: start time `0.040000` (1 frame pada 25fps, H.264), keyframe I-frame di frame awal.
  - Struktur MP4: moov atom di awal file (`-movflags +faststart`) untuk streaming instan di browser.
  - Decode FFmpeg 2 detik awal (`ffmpeg -xerror -ss 0 -t 2 -f null -`): 0 error, 0 desync, 0 frame corrupt.
  - Subtitle klip shifted: `storage/raw-clips/podcast-clip-01.srt` dan `.json` mulai tepat di `00:00,000` (7 baris dialog).
  - Unit test suite diperbarui: `npm test` — **PASS 34/34**.
- **Status:** Selesai (Fase 2 tuntas 100%).

## [2026-11-20] Database Schema, Model Eloquent & Relasi (Fase 3 - Item 1)
- **Tujuan:** Bootstrap Laravel 12 di `backend/`, koneksi MySQL `x7clip`, migrasi `projects`/`clips`/`render_jobs`, model Eloquent dengan casts serta relasi cascade.
- **Environment:** PHP 8.2.12 (XAMPP), Composer 2.6.6, MariaDB 10.4 XAMPP di `127.0.0.1:3307`, user `root` tanpa password, database `x7clip`.
- **File ditambahkan:**
  - `backend/` — skeleton Laravel 12 (`laravel/framework` v12.73.0) + `vendor/` + `composer.lock`.
  - `backend/database/migrations/2026_11_20_000001_create_projects_table.php`
  - `backend/database/migrations/2026_11_20_000002_create_clips_table.php`
  - `backend/database/migrations/2026_11_20_000003_create_render_jobs_table.php`
  - `backend/app/Models/Project.php`, `backend/app/Models/Clip.php`, `backend/app/Models/RenderJob.php`
  - `backend/tests/Feature/DatabaseConnectionTest.php`
  - `backend/tests/Feature/Models/ProjectModelTest.php`, `ClipModelTest.php`, `CascadeDeleteTest.php`
- **Keputusan:**
  - Koordinat klip `start_sec`/`end_sec` = `decimal(8,3)` dengan cast `float` di model.
  - Field JSON transkrip/subtitle/edit config = `longText` dengan cast `array`.
  - Foreign key `clips.project_id` dan `render_jobs.clip_id` memakai `cascadeOnDelete()`.
  - `phpunit.xml` dibiarkan tanpa override SQLite sehingga test memakai koneksi `.env` (`x7clip`).
- **Hasil uji:**
  - `php artisan migrate:fresh` — sukses, 6 migrasi (termasuk 3 tabel default Laravel).
  - `php artisan test` — **PASS 6/6 tests, 20 assertions** (termasuk cascade delete project -> clips -> render_jobs).
- **Status:** Selesai (Fase 3 Item 1 tuntas).

## [2026-11-20] Endpoint POST /api/projects & Redis Job Push (Fase 3 - Item 2)
- **Tujuan:** Terima URL YouTube, simpan project `queued`, lalu push job analisis ke list Redis mentah `x7:jobs` untuk dikonsumsi worker.
- **File ditambahkan/diubah:**
  - `backend/app/Support/JobQueue.php` — helper statis `push(string $type, array $data)` via `Redis::connection()->lpush('x7:jobs', json_encode(...))`.
  - `backend/app/Http/Requests/StoreProjectRequest.php` — `youtube_url` required|string|max:512 + regex YouTube (watch, youtu.be, live, shorts).
  - `backend/app/Http/Controllers/Api/ProjectController.php` — create project, push job, 201 `{"data":{...}}`; push gagal -> `status=failed` + 503.
  - `backend/routes/api.php`, `backend/bootstrap/app.php` — registrasi route API tanpa Sanctum/`install:api`.
  - `backend/tests/Feature/Api/ProjectApiTest.php` — 3 feature test (invalid 422 tanpa job, watch URL 201 + job, youtu.be & /live/ diterima).
  - `backend/.env`, `backend/.env.example` — `REDIS_CLIENT=predis` (`predis/predis` v3.7.1, tanpa ekstensi phpredis).
- **Kontrak job Redis (`x7:jobs`):** `{"type":"analyze_project","project_id":<id>,"attempt":1}`.
- **Hasil uji:**
  - `php artisan test` — **PASS 9/9 tests, 35 assertions** (6 test lama + 3 test API).
  - `php artisan route:list --path=api` — `POST api/projects` -> `Api\ProjectController@store` (1 route).
- **Status:** Selesai (Fase 3 Item 2 tuntas).

## [2026-11-20] Endpoint GET /api/projects/{id} (Fase 3 - Item 3)
- **Tujuan:** Kembalikan status pipeline project + daftar klip rekomendasi untuk polling frontend.
- **File diubah:**
  - `backend/app/Http/Controllers/Api/ProjectController.php` — `show()` eager-load `clips` urut `viral_score` DESC.
  - `backend/routes/api.php` — `GET /api/projects/{project}`.
  - `backend/tests/Feature/Api/ProjectShowApiTest.php` — 404 project tak dikenal + 200 dengan urutan skor & presisi desimal.
- **Respons:** `{"data":{id, youtube_url, video_title, duration_sec, status, error_message, created_at, clips:[{id,title,start_sec,end_sec,viral_score,hook_type,ai_reason,suggested_caption,raw_clip_path}]}}`.
- **Hasil uji:** `php artisan test` — **PASS 11/11 tests, 46 assertions**.
- **Status:** Selesai (Fase 3 Item 3 tuntas).

## [2026-11-20] Consumer Redis Worker (Fase 3 - Item 7)
- **Tujuan:** Worker Node mendengarkan list Redis `x7:jobs`, menjalankan pipeline analisis, dan menulis hasil ke DB.
- **File ditambahkan/diubah:**
  - `worker/src/consumer.js` — `BRPOP x7:jobs` (literal, tanpa prefix), dispatch `analyze_project`, retry maks 3 attempt (`attempt` +1 di-requeue), status `extracting` -> `analyzing` -> `ready`/`failed`.
  - `worker/src/db.js` — satu-satunya modul MySQL (`mysql2/promise`): `markExtracting`, `saveTranscript`, `markAnalyzing`, `markQueued`, `failProject`, `saveClipsAndReady`.
  - `worker/src/env.js` — loader `.env` sederhana untuk runtime worker.
  - `worker/test/consumer.test.js` — 6 test (happy path, project hilang, requeue, failed, tipe job tak dikenal, serialisasi params DB).
  - `worker/package.json` — dependency `mysql2` + script `npm run consumer`.
- **Guardrail yang diterapkan:**
  - Query MySQL terisolasi di `worker/src/db.js` (mudah diganti HTTP callback).
  - `REDIS_PREFIX=` kosong di `backend/.env{,.example}`; diverifikasi `redis-cli keys *jobs*` hanya `x7:jobs`.
  - Test backend memakai database terpisah `x7clip_test` lewat `phpunit.xml`.
  - Insert `clips` + update `projects.status='ready'` dalam satu transaksi; `created_at`/`updated_at` diisi `NOW()`; kolom JSON diserialisasi `JSON.stringify()`.
- **Hasil uji:** `npm test` — **PASS 40/40** (34 test lama + 6 test consumer).
- **Status:** Selesai (Fase 3 Item 7 tuntas).

## [2026-11-21] Endpoint Simpan Konfigurasi Editor (Fase 3 - Item 5)
- **Tujuan:** Menyimpan state editor (trim, rasio, crop, style subtitle) dan revisi subtitle sebelum render final.
- **File ditambahkan/diubah:**
  - `backend/app/Http/Controllers/Api/ClipController.php` — `updateConfig()`: partial merge `edit_config_json`, replace `subtitle_json`.
  - `backend/routes/api.php` — `PATCH /api/clips/{clip}/config`.
  - `backend/app/Http/Controllers/Api/ProjectController.php` — `show()` mengekspos `subtitle_json` + `edit_config_json` per klip.
  - `backend/tests/Feature/Api/ClipConfigApiTest.php` — 7 test (404, simpan+replace, partial patch, validasi rasio/crop, trim di luar durasi, subtitle terbalik, GET project state).
- **Validasi:**
  - `aspect_ratio` ∈ `16:9|9:16`; `crop_x` 0..1; `font_size` 8..200; `subtitle.position` ∈ `top|middle|bottom`.
  - `trim_end > trim_start` dan rentang trim ≤ durasi klip (`end_sec - start_sec`).
  - Tiap subtitle `end > start`; teks maks 500 karakter; maks 2000 baris.
- **Hasil uji:** `php artisan test` — **PASS 25/25 (98 assertions)**.
- **Status:** Selesai (Fase 3 Item 5 tuntas).

## [2026-11-21] Antrean Render Final & Polling Progres (Fase 3 - Item 6)
- **Tujuan:** Endpoint antre render final dari state editor + endpoint polling progres untuk UI.
- **File ditambahkan/diubah:**
  - `backend/app/Http/Controllers/Api/RenderJobController.php` — `store()` + `show()`.
  - `backend/routes/api.php` — `POST /api/clips/{clip}/render`, `GET /api/render-jobs/{renderJob}`.
  - `backend/tests/Feature/Api/ClipRenderApiTest.php` — 6 test (409 klip belum siap, create+push, reuse job aktif, enqueue gagal 503, show progres/output, 404).
- **Kontrak:**
  - Klip belum `ready` / file mentah hilang → 409 tanpa membuat job.
  - Sukses → `render_jobs` baru (`queued`, `progress_percent=0`) + push `render_clip` → 202.
  - Job `queued|rendering` aktif dipakai ulang → 202 tanpa push (anti double-render).
  - Gagal enqueue Redis → job `failed` + 503.
- **Hasil uji:** `php artisan test` — **PASS 31/31 (128 assertions)**.
- **Status:** Selesai (Fase 3 tuntas). Handler `render_clip` + `renderer.js` menyusul di Fase 5 Item 1.

## [2026-11-21] Final Render Engine & Handler Render (Fase 5 - Item 1)
- **Tujuan:** Render final FFmpeg (trim → crop/scale → burn-in subtitle) plus update progres ke `render_jobs`.
- **File ditambahkan/diubah:**
  - `worker/src/renderer.js` — `buildArgs`, `buildFilters`, `parseProgressPercent`, `trimRange`, `renderClip` (spawn FFmpeg).
  - `worker/src/subtitleShift.js` — `toAss` menerima `playResX/Y`, `alignment`, `primaryColour`; helper `assColour('#RRGGBB')`.
  - `worker/src/db.js` — `getRenderJob`, `markRenderStarted`, `updateRenderProgress`, `markRenderDone`, `markRenderFailed`; `getClip` kini membawa `subtitle_json`/`edit_config_json`.
  - `worker/src/consumer.js` — `renderClipJob` + dispatch `render_clip` (progres di-throttle 5%, gagal tidak crash).
  - `worker/test/{renderer,consumer}.test.js` — test murni renderer + handler render.
  - `.env.example` — `SUBTITLE_FONT=Arial`.
- **Kontrak render:**
  - Output `storage/exports/clip-<clipId>-render-<jobId>.mp4`, `output_url` relatif terhadap root proyek.
  - 16:9 → `scale=1920:1080` + letterbox; 9:16 → crop lebar `ih*9/16` posisi `crop_x` (0..1) lalu `scale=1080:1920`.
  - ASS sementara di `storage/tmp/` memakai PlayRes sama dengan output, dihapus setelah render.
- **Hasil uji:** `npm test` — **PASS 57/57**. Smoke riil `clip-11.mp4`: FFmpeg exit 0, `ffprobe` 1080x1920, 4.004s, subtitle burn-in tanpa error filter.
- **Status:** Selesai (Fase 5 Item 1 tuntas). User harus restart consumer agar handler `render_clip` aktif.

## [2026-11-21] Scaffold Frontend & Status Tracker (Fase 4 - Item 1)
- **Tujuan:** Aplikasi React untuk input URL YouTube dan memantau pipeline sampai `ready`/`failed`.
- **File ditambahkan/diubah:**
  - `frontend/package.json` — React 19, Vite 6, Tailwind v4 (`@tailwindcss/vite`), font display/sans/mono.
  - `frontend/vite.config.js` — plugin react + tailwind, proxy `/api` → `http://127.0.0.1:8000`.
  - `frontend/src/api.js` — `createProject`, `getProject`, plus stub `patchClipConfig`, `prepareClip`, `renderClip`, `getRenderJob`; error membawa `err.status` dan `err.body`.
  - `frontend/src/App.jsx` — form URL + validasi 422 server, panel pipeline, polling 2 dtk (berhenti di `ready`/`failed`), ringkasan `N klip siap`, reset.
  - `frontend/src/components/StatusTracker.jsx` — stepper 4 tahap (antrean/ekstraksi/analisis/siap), state done/active/failed.
  - `frontend/src/index.css` — token `@theme` (void/panel/ink/accent/ok/fail), animasi rise/stage-pulse, `prefers-reduced-motion`.
- **Aksesibilitas:** label input, `aria-live` status, `role="alert"` error, focus-visible, submit via Enter.
- **Hasil uji:** `npm run build` — **PASS** (31 modules, CSS 21.31 kB, JS 235.95 kB).
- **Status:** Selesai (Fase 4 Item 1 tuntas). Placeholder "Lihat rekomendasi klip" diganti di Item 2.

## [2026-11-21] Daftar Rekomendasi Klip (Fase 4 - Item 2)
- **Tujuan:** Menampilkan klip hasil AI dengan skor, hook, durasi, alasan, dan aksi persiapan klip.
- **File ditambahkan/diubah:**
  - `frontend/src/components/ClipList.jsx` — grid kartu klip, badge skor viral, chip hook (ID), durasi `m:ss`, alasan AI, caption; aksi "Edit Klip"/"Coba lagi" → `prepareClip`; badge state `idle|preparing|ready|failed`; empty state.
  - `frontend/src/App.jsx` — `shouldKeepPolling` (lanjut polling saat `ready` tapi masih ada klip `preparing`), render `<ClipList>` di bawah tracker.
- **Perilaku:**
  - Klik "Edit Klip" → POST prepare, lalu refresh project; poll 2 dtk berhenti saat tidak ada klip `preparing`.
  - Error prepare (409/503/jaringan) tampil per kartu (`role="alert"`), daftar tetap utuh.
  - `ready` → tombol "Buka editor" placeholder (item 3).
- **Hasil uji:** `npm run build` — **PASS** (32 modules, CSS 23.50 kB, JS 241.23 kB).
- **Status:** Selesai (Fase 4 Item 2 tuntas).

## [2026-11-21] Web Editor: Player + Trim Slider (Fase 4 - Item 3)
- **Tujuan:** Editor klip dengan pemutar video dan pemilihan rentang trim.
- **File ditambahkan/diubah:**
  - `frontend/src/components/Editor.jsx` — player `<video src="/api/clips/{id}/video">`, transport play/pause, timeline scrubber + dua handle trim, tombol simpan/reset.
  - `frontend/src/components/ClipList.jsx` — tombol "Buka editor" aktif saat `prepare_status=ready`, prop `onOpenEditor`.
  - `frontend/src/App.jsx` — state `editingClipId`, render `Editor` vs list, polling pause saat editor aktif.
- **Kontrak:**
  - Durasi clip = `end_sec - start_sec`; `trim_start/trim_end` relatif `00:00` klip, minimum gap 1 dtk.
  - Handle trim: pointer capture (mouse/touch) + keyboard Arrow 0.1 dtk / Shift 1 dtk / Home/End, `role="slider"` + `aria-value*`.
  - Playback loop kembali ke `trim_start` saat melewati `trim_end`; play di luar rentang otomatis seek.
  - Simpan: `PATCH /api/clips/{id}/config` body `{ edit_config: { trim_start, trim_end } }` (partial merge, kunci lain tetap).
  - Video error → overlay + muat ulang; error simpan tampil inline.
- **Hasil uji:** `npm run build` — **PASS** (33 modules, CSS 27.77 kB, JS 252.31 kB).
- **Status:** Selesai (Fase 4 Item 3 tuntas).

## [2026-11-21] Rasio Aspek & Overlay Crop (Fase 4 - Item 4)
- **Tujuan:** Mode `16:9` / `9:16` dengan pemilihan area crop vertikal yang konsisten dengan render final.
- **File diubah:**
  - `frontend/src/components/Editor.jsx` — state `aspectRatio` + `cropX`, geometri stage via `ResizeObserver` + `videoWidth/Height`, overlay crop 9:16 draggable, simpan gabungan trim + rasio + crop.
- **Kontrak:**
  - `crop_x = left / (displayW - frameW)`, rentang 0..1 — sama dengan perhitungan renderer (`crop_x * (iw - ih*9/16)`).
  - Overlay 9:16: border + dim/hatch di luar area, pointer capture mouse/touch, keyboard Arrow ±1% / Shift ±10% / Home/End, `role="slider"`.
  - Mode 16:9 menyembunyikan overlay dan memakai frame penuh.
  - Satu PATCH `edit_config` berisi `trim_start`, `trim_end`, `aspect_ratio`, `crop_x` (partial merge).
  - Reset crop ke tengah (0.5) tersedia.
- **Hasil uji:** `npm run build` — **PASS** (33 modules, CSS 28.67 kB, JS 257.26 kB).
- **Status:** Selesai (Fase 4 Item 4 tuntas).

## [2026-11-21] Panel Subtitle & Caption Live (Fase 4 - Item 5)
- **Tujuan:** Mengedit subtitle bertimestamp dan melihat hasilnya langsung di player sebelum render.
- **File diubah/ditambah:**
  - `frontend/src/components/Editor.jsx` — state `subtitle` (enabled/position/font_size/color) + daftar baris (start/end string, text), overlay caption live, validasi baris, simpan gabungan.
  - `backend/app/Http/Controllers/Api/RenderJobController.php` — `download()` (`response()->file`, `Content-Disposition: attachment`).
  - `backend/routes/api.php` — `GET /api/render-jobs/{renderJob}/download`.
  - `backend/tests/Feature/Api/ClipRenderApiTest.php` — test unduh file done + 404 saat belum done/file hilang.
- **Kontrak:**
  - Baris subtitle: `start>=0`, `end>start`, `end<=durasi+0.5`, teks non-kosong maks 500; diurutkan per `start` saat simpan.
  - Simpan satu PATCH: `edit_config.subtitle` + `subtitles` (replace penuh), bersama trim/rasio/crop.
  - Overlay: `fontPx = font_size * (displayedHeight / outputHeight)`, `outputHeight` 1920 (9:16) / 1080 (16:9), font `Arial`, dipotong ke area crop 9:16.
  - Download hanya untuk job `done` dengan file ada; selain itu 404.
- **Hasil uji:** `npm run build` PASS (33 modules); `php artisan test` PASS 33/33.
- **Status:** Selesai (Fase 4 Item 5 tuntas).

## [2026-11-21] Render Final & Unduh dari Editor (Fase 4 - Item 6)
- **Tujuan:** Menghubungkan tombol Render final ke antrean worker, menampilkan progres, dan mengunduh `.mp4`.
- **File diubah:** `frontend/src/components/Editor.jsx` — section "Ekspor", state render, polling, link unduh.
- **Perilaku:**
  - Render hanya aktif setelah config tersimpan; jika ada perubahan, tampil "Simpan dulu".
  - `POST /api/clips/{id}/render` → simpan job (queued) → poll `GET /api/render-jobs/{id}` tiap 1.5 dtk sampai `done|failed`.
  - Progress bar `role="progressbar"` + status `queued/rendering/done/failed`; progres tidak pernah mundur.
  - Job aktif dipakai ulang (tidak dobel render); tombol nonaktif saat queued/rendering.
  - `done` → tautan unduh `/api/render-jobs/{id}/download` + "Render ulang"; `failed` → `error_message` + "Coba lagi".
  - Error polling berhenti (tidak spam) dengan tombol coba lagi; timer dibersihkan saat unmount/ganti klip.
- **Hasil uji:** `npm run build` PASS (33 modules); `php artisan test` PASS 33/33 (135 assertions).
- **Status:** Selesai (Fase 4 tuntas 6/6).

## [2026-11-21] Batas Konkurensi Worker Render (Fase 5 - Item 2)
- **Tujuan:** Mencegah CPU penuh saat beberapa klip dirender bersamaan.
- **File diubah:**
  - `worker/src/consumer.js` — `renderConcurrency()` (env `RENDER_CONCURRENCY`, default 1, clamp 1–2), `createLimiter()`, lane render terpisah dari job analisis/prepare, `inFlight` tracking + shutdown menunggu render aktif.
  - `worker/test/consumer.test.js` — 3 test (clamp env, batas paralel + urutan, error tidak menghentikan antrean).
  - `.env.example` — `RENDER_CONCURRENCY=1` menggantikan `WORKER_CONCURRENCY`.
  - `docs/RUNNING.md` — catatan batas per proses consumer.
- **Perilaku:**
  - Job `render_clip` masuk limiter (maks 1–2 paralel); job lain tetap diproses di loop utama.
  - Shutdown (`Ctrl+C`) menunggu render aktif selesai sebelum menutup koneksi DB.
  - Batas berlaku per proses consumer; satu consumer per mesin.
- **Hasil uji:** `npm test` — **PASS 60/60**.
- **Status:** Selesai (Fase 5 Item 2 tuntas).

## [2026-11-21] Scheduled Cleanup File Sementara (Fase 5 - Item 3)
- **Tujuan:** Membersihkan file sementara di `storage/tmp/` dan potongan klip di `storage/raw-clips/` yang berusia lebih dari 24 jam agar disk tidak penuh.
- **File ditambahkan/diubah:**
  - `worker/scripts/cleanup.js` — script pembersih dengan opsi `--dry-run`, konfigurasi umur via `CLEANUP_MAX_AGE_HOURS` (default 24 jam).
  - `worker/test/cleanup.test.js` — 5 test (hapus file > 24 jam, perlindungan file baru dan `.gitkeep`, mode `--dry-run`, direktori tidak ada, toleransi error permission).
  - `worker/package.json` — penambahan script `npm run cleanup`.
  - `.env.example` — penambahan variabel `CLEANUP_MAX_AGE_HOURS=24`.
- **Guardrail:**
  - File `.gitkeep` tidak pernah dihapus.
  - Folder `storage/exports/` (hasil render final) dan `storage/transcripts/` tidak masuk target penghapusan.
- **Hasil uji:** `npm test` — **PASS 65/65**.
- **Status:** Selesai (Fase 5 Item 3 tuntas).

## [2026-11-21] Upload Video Lokal MP4 & Subtitle Fallback (Fase 5 - Item 4)
- **Tujuan:** Fallback cadangan jika IP server dibatasi atau diblokir oleh YouTube.
- **File ditambahkan/diubah:**
  - `backend/database/migrations/2026_11_21_040356_add_local_upload_fields_to_projects_table.php` — `youtube_url` dibuat nullable, penambahan kolom `source_type` ('youtube'|'upload') dan `local_video_path`.
  - `backend/app/Models/Project.php` — fillable `source_type`, `local_video_path`.
  - `backend/app/Http/Controllers/Api/ProjectController.php` — endpoint `upload()` menerima multipart `video` (mp4/mov/m4v max 500MB) dan `subtitle` (vtt/srt max 10MB), simpan ke `storage/uploads/`, enqueue job `analyze_project` dengan parameter upload.
  - `backend/tests/Feature/Api/ProjectUploadApiTest.php` — test validasi required dan alur upload berhasil + enqueue Redis.
  - `worker/src/clipper.js` — fungsi `clipLocalFile()`: pemotongan video parsial langsung dari file MP4 lokal via FFmpeg (tanpa `yt-dlp`).
  - `worker/src/db.js` — query project menyertakan `source_type`, `local_video_path`, `video_title`.
  - `worker/src/consumer.js` — dukungan `source_type === 'upload'` pada `analyzeProject` (baca subtitle langsung dari disk + ambil durasi via `ffprobe`) dan `prepareClip` (panggil `clipLocalFile`).
  - `frontend/src/api.js` — fungsi `uploadProject({ videoFile, subtitleFile })`.
  - `frontend/src/App.jsx` — tab selector (Tautan YouTube vs Unggah Video Lokal), form upload file MP4 dan subtitle VTT/SRT dengan progress spinner dan error feedback, handing over langsung ke status tracker.
- **Hasil uji:**
  - `php artisan test` — **PASS 35/35 (150 assertions)**.
  - `npm test` (worker) — **PASS 65/65**.
  - `npm run build` (frontend) — **PASS** (33 modules, CSS 32.10 kB / JS 279.13 kB).
- **Status:** Selesai (Fase 5 tuntas & seluruh MVP Fase 0 s/d 5 selesai!).

## [2026-11-21] Font Viral Terpisah, Caption Gen Z 9router & Stabilitas Preview/Auto-Save (Fase 8)
- **Tujuan:** 6 font viral open-source TTF, pembaca nama internal OpenType `name`, escaping Windows `fontsdir`, pemilih font terpisah untuk `hook_font` dan `subtitle_font`, AI caption generator Gen Z + 3 hashtag via 9router dengan fallback baca root `.env`, perbaikan auto-save `AbortController` + debounce 800ms + `withoutMiddleware('throttle')`, serta single-stream `<video>` + `<canvas>` blur background.
- **File diubah/ditambah:**
  - `storage/fonts/` & `frontend/public/fonts/` — bundle 6 font TTF (Montserrat-ExtraBold, Poppins-Black, Anton-Regular, BebasNeue-Regular, Oswald-Bold, PlusJakartaSans-ExtraBold).
  - `worker/src/fonts.js` — parser tabel OpenType `name` (`readTtfFontName`), map `VIRAL_FONTS`, dan resolver nama keluarga font `getFontNameFromFile`.
  - `worker/src/renderer.js` — render banner dengan `hook_font` dan subtitle dengan `subtitle_font`, normalisasi path Windows `fontsdir` (`D\:/...`).
  - `worker/src/subtitleShift.js` — `toAss()` menerima `bannerFontName` dan `fontName` terpisah untuk style banner dan default.
  - `worker/src/ninerouter.js` & `worker/src/validator.js` — system prompt menghasilkan `suggested_caption` gaya Gen Z Indonesia + 3 hashtag relevan.
  - `backend/config/services.php` & `backend/.env.example` — konfigurasi `services.ninerouter` dengan fallback otomatis membaca root `.env` (`base_path('../.env')`).
  - `backend/app/Http/Controllers/Api/ClipController.php` — validasi fleksibel `edit_config`, endpoint `generateCaption()` dengan `temperature: 0.85` tanpa template statis + respons `502` saat 9router gagal, dan pembersihan output buffer di `video()`.
  - `backend/routes/api.php` — `withoutMiddleware('throttle')` pada `PATCH /api/clips/{clip}/config` dan rute `POST /api/clips/{clip}/caption`.
  - `backend/tests/Feature/Api/ClipCaptionApiTest.php` — feature test dengan `Http::fake()` untuk verifikasi request transkrip ke 9router, penyimpanan `suggested_caption`, dan error `502` saat gagal.
  - `frontend/src/index.css` — pendaftaran `@font-face` untuk keenam font TTF.
  - `frontend/src/components/Editor.jsx` — single-stream `<video>` + `<canvas>` blur background, `isSeekingRef` guard untuk auto-skip, `AbortController` + debounce 800ms untuk auto-save dengan tombol `Coba Lagi`, pemilih font Hook Banner & Subtitle, serta panel Caption Medsos.
  - `frontend/src/api.js` — dukungan `options` (`signal`) pada `patchClipConfig()` dan method `regenerateCaption()`.
- **Hasil uji:**
  - `php artisan test` — **PASS 42/42 (191 assertions)**.
  - `npm test` (worker) — **PASS 87/87**.
  - `npm run build` (frontend) — **PASS** (33 modules, JS 290.61 kB).
- **Status:** Selesai (Fase 8 tuntas).











