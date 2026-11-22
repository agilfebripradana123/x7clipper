# AGENTS.md — Panduan & Memori Coding Agent (Web Clipper)

> **PROTOKOL WAJIB UNTUK SETIAP SESI AI AGENT:**
> 1. Baca `AGENTS.md` (file ini) dan `PRD.md` sepenuhnya sebelum menulis atau mengubah kode apa pun.
> 2. Kerjakan **HANYA 1 item `[ ]`** pada fase aktif dalam satu giliran kerja, kecuali user secara eksplisit meminta beberapa item sekaligus.
> 3. DILARANG mengubah atau melanggar **Aturan Arsitektur Wajib (Bagian 2)** tanpa konfirmasi user.
> 4. Verifikasi kode yang dibuat (jalankan test, lint, atau uji CLI/endpoint) sebelum menandai selesai.
> 5. Setelah selesai, WAJIB update file ini:
>    - Ubah `[ ]` menjadi `[x]` pada tugas yang selesai.
>    - Perbarui bagian **Status Terakhir & Handoff Log (Bagian 6)**.
>    - Catat keputusan teknis baru atau workaround bug di **Log Keputusan Teknis (Bagian 5)**.

---

## 1. Konteks Teknis & Struktur Proyek

Referensi fungsional lengkap ada di `PRD.md`.

### Stack Utama
- **Backend API:** Laravel (PHP 8.2+) + MySQL
- **Queue Broker:** Redis (`127.0.0.1:6379`)
- **Media & AI Worker:** Node.js (LTS) — mengeksekusi `yt-dlp`, `FFmpeg`, `ffprobe`, parser transkrip, dan client **9router**
- **AI Gateway:** 9router (OpenAI-compatible endpoint `/v1/chat/completions`)
- **Frontend & Editor:** React + Vite + Tailwind CSS
- **Storage:** Lokal `./storage/` (development), Cloudflare R2 / S3 (produksi)

*(Catatan: Jika user mengganti stack Backend ke Node.js penuh, update bagian ini dan catat di ADR).*

### Struktur Folder
```text
web-clipper/
├── PRD.md                 # Spesifikasi produk & fitur
├── AGENTS.md              # Memori, aturan arsitektur, dan to-do list agent
├── backend/               # REST API (Laravel), migrasi DB, dispatcher Redis Queue
├── worker/                # Worker Node.js: yt-dlp, chunker transkrip, 9router client, FFmpeg
├── frontend/              # UI React + Vite + Tailwind (list klip & web video editor)
└── storage/               # Di-gitignore: tmp/, transcripts/, raw-clips/, exports/
```

---

## 2. Aturan Arsitektur Wajib (Non-Negotiable)

1. **Segment-ID Anchoring (Anti-Halusinasi Timestamp):**
   - DILARANG meminta LLM menebak angka detik mentah.
   - Normalizer wajib menggabungkan caption pendek menjadi segmen kalimat 6–10 detik berformat `[S{id}|{detik}] {teks}` dan menyimpan `segmentMap` (`S1 -> { start, end, text }`).
   - Output 9router wajib merujuk `start_segment_id` dan `end_segment_id`; backend/worker yang memetakan kembali ke detik float presisi.

2. **Sliding Window Chunking:**
   - Durasi video < 20 menit (1200 detik): kirim utuh dalam 1 request.
   - Durasi video >= 20 menit: pecah per 15 menit (900 detik) dengan overlap 2 menit (120 detik).
   - Gabungkan semua hasil chunk lalu deduplikasi: jika dua klip bertumpuk > 50% durasi klip terpendek, simpan hanya yang memiliki `viral_score` tertinggi.

3. **Validasi Output AI & Padding Pengaman:**
   - Wajib gunakan `temperature: 0.2` dan `response_format: { "type": "json_object" }` saat memanggil 9router.
   - Bersihkan pembungkus markdown code fence (` ```json `) sebelum `JSON.parse()`.
   - Tolak item klip jika ID tidak ada di `segmentMap`, `end <= start`, atau durasi < 15 detik / > 110 detik (skip item bermasalah, jangan gagalkan seluruh chunk).
   - Terapkan padding: `safeStart = Math.max(0, start - 0.35)` dan `safeEnd = Math.min(videoDuration, end + 0.50)`.

4. **Smart Clipping (Dilarang Download Full Video):**
   - Ambil potongan segmen langsung memakai `yt-dlp --download-sections "*start-end"`.
   - Re-encode awal potongan via FFmpeg (`-c:v libx264 -preset veryfast -c:a aac`) agar *keyframe* bersih dan tidak freeze di browser.
   - Geser mundur seluruh timestamp subtitle klip sebesar `safeStart` agar selalu dimulai di `00:00`.

5. **Sinkronisasi Preview Browser vs Render FFmpeg:**
   - Koordinat crop (`crop_x`) dan posisi teks di `edit_config_json` WAJIB disimpan dalam rasio `0.0` hingga `1.0`, BUKAN piksel absolut.
   - Simpan file font `.ttf`/`.otf` di folder shared agar font CSS di frontend sama persis dengan font yang dipakai filter FFmpeg.

6. **Asinkron & Batas Konkurensi:**
   - Seluruh proses `yt-dlp`, analisis 9router, dan render `FFmpeg` WAJIB berjalan asinkron melalui Redis Queue.
   - Batasi worker render FFmpeg maksimal 1–2 job konkuren agar CPU tidak penuh.

7. **DILARANG Menjalankan Daemon dari Shell Agent:**
   - JANGAN pernah menjalankan `node src/consumer.js`, `php artisan serve`, atau daemon/background process apa pun lewat `Start-Process`/`&`/`nohup` di shell tool. Pipe terminal menggantung dan proses jadi tak terkendali.
   - Server backend dan worker consumer SELALU dijalankan manual oleh user di terminal terpisah. Agent cukup mengirim job ke Redis atau memanggil endpoint HTTP.

---

## 3. Kontrak JSON & System Prompt Standar 9router

### Kontrak JSON Output 9router
```json
{
  "chunk_summary": "Ringkasan 1 kalimat topik chunk ini",
  "clips": [
    {
      "title": "Judul hook singkat max 60 karakter",
      "start_segment_id": "S101",
      "end_segment_id": "S108",
      "viral_score": 88,
      "hook_type": "contrarian | story | actionable_tip | emotional | debate",
      "reason": "Alasan singkat kenapa momen ini menarik dan utuh",
      "suggested_caption": "Caption singkat media sosial"
    }
  ]
}
```

### Aturan Prompt Wajib
- Instruksikan AI mencari 1–4 momen per chunk berdurasi ideal 30–75 detik dengan hook kuat dan penutup tuntas.
- Izinkan array `"clips": []` jika chunk hanya berisi intro/iklan/obrolan datar.
- Larang keras mengarang ID segmen di luar daftar `[S{id}|{detik}]` yang diberikan.

---

## 4. Master To-Do List (Kerjakan Berurutan)

### Fase 0: Setup & Verifikasi Environment
- [x] Inisialisasi struktur folder (`backend/`, `worker/`, `frontend/`, `storage/tmp`, `storage/transcripts`, `storage/raw-clips`, `storage/exports`) dan `.gitignore`.
- [x] Buat `.env.example` (9router URL/Key/Model, Redis host/port, DB config, path `yt-dlp`, `ffmpeg`, `ffprobe`).
- [x] Buat script `worker/scripts/healthcheck.js` untuk verifikasi `yt-dlp`, `ffmpeg`, `ffprobe`, ping Redis, dan test request ringan ke 9router.

### Fase 1: Pipeline Transkrip & AI Selector (Worker CLI Dulu)
- [x] Buat modul `worker/src/youtube.js`: ambil metadata JSON dan download subtitle/auto-caption via `yt-dlp`.
- [x] Buat modul `worker/src/transcript.js`: parse VTT/SRT -> gabungkan menjadi segmen 6–10 detik `[S{id}|{detik}]` + kembalikan `segmentMap`.
- [x] Buat modul `worker/src/chunker.js`: pecah transkrip per 15 menit dengan overlap 2 menit untuk video >= 20 menit.
- [x] Buat modul `worker/src/ninerouter.js`: client `/v1/chat/completions` dengan system prompt standar, strip markdown fence, dan retry 1x jika JSON invalid.
- [x] Buat modul `worker/src/validator.js`: validasi skema Zod, Segment-ID grounding, padding (`-0.35s` / `+0.50s`), dan deduplikasi overlap > 50%.
- [x] Buat CLI runner uji coba (`worker/scripts/test-analyze.js`) dan test pada 1 video 10–15 menit serta 1 podcast > 45 menit.

### Fase 2: Smart Clipping & Subtitle Shifting
- [x] Buat modul `worker/src/clipper.js`: potong segmen parsial via `yt-dlp --download-sections` + rapikan keyframe via FFmpeg.
- [x] Buat modul `worker/src/subtitleShift.js`: ambil irisan transkrip sesuai `start_sec..end_sec` dan geser timestamp mundur agar mulai dari `00:00` (output JSON & `.srt`/`.ass`).
- [x] Uji pemutaran hasil `.mp4` klip di browser (pastikan audio sinkron dan tidak freeze di 2 detik awal).

### Fase 3: Backend API, Database & Redis Queue
- [x] Buat migrasi & model database untuk `projects`, `clips`, dan `render_jobs` sesuai `PRD.md`.
- [x] Buat endpoint `POST /api/projects` (validasi URL -> simpan project -> push job analisis ke Redis).
- [x] Buat endpoint `GET /api/projects/{id}` (kembalikan status pipeline + daftar `clips`).
- [x] Buat endpoint `POST /api/clips/{id}/prepare` (push job smart clipping untuk klip yang dipilih user).
- [x] Buat endpoint `GET /api/clips/{id}/video` (`response()->file()`, Range/206) + tracking `prepare_status`/`prepare_error`.
- [x] Buat endpoint `PATCH /api/clips/{id}/config` (simpan `edit_config_json` dan revisi `subtitle_json`).
- [x] Buat endpoint `POST /api/clips/{id}/render` dan `GET /api/render-jobs/{id}` (antrean render final + polling progres).
- [x] Hubungkan consumer Redis Queue di `worker/` agar mendengarkan job dari Backend dan mengupdate status/progres ke API/DB.

### Fase 4: Frontend & Web Video Editor
- [x] Setup React + Vite + Tailwind + API client dan halaman Input URL YouTube + status tracker pipeline.
- [x] Buat halaman Daftar Rekomendasi Klip (tampilkan judul, `viral_score`, `hook_type`, alasan AI, durasi, dan tombol "Edit Klip").
- [x] Buat komponen Web Editor: HTML5 `<video>` player + dual-handle slider trim start/end.
- [x] Buat kontrol rasio aspek (`16:9` / `9:16`) dengan overlay frame crop yang bisa digeser horizontal (simpan `crop_x` dalam `0.0 - 1.0`).
- [x] Buat panel editor teks subtitle + live caption overlay di atas video player.
- [x] Hubungkan tombol "Export / Render Final" dengan progress bar polling dan tombol download `.mp4`.

### Fase 5: Final Render Engine & Hardening
- [x] Buat `worker/src/renderer.js`: builder perintah FFmpeg untuk `trim` + `crop 9:16` (hitung dari rasio `crop_x`) + `burn-in` subtitle `.ass` dengan font identik frontend + parser progres persen FFmpeg.
- [x] Terapkan batas konkurensi worker render (maks 1–2 job simultan).
- [x] Buat scheduled cleanup job untuk menghapus file sementara di `storage/tmp/` dan `storage/raw-clips/` yang berusia > 24 jam.
- [x] Tambahkan endpoint & UI cadangan: Upload file MP4 lokal (fallback jika IP server terkena blokir YouTube).

### Fase 6: Post-MVP Polish & Multi-Cut (Rencana Bertahap)
- [x] **Tahap 1: Fix Resolusi & Ketajaman Output**
  - Di `clipper.js`: ganti format yt-dlp ke `bv*[height<=1440]+ba/b` dengan `--merge-output-format mp4` (native 810x1440 untuk crop 9:16, tajam tanpa beban decode 4K AV1), pastikan keyframe dan audio tetap sinkron.
  - Di `renderer.js`: terapkan `-sws_flags lanczos` dan `-crf 18` dengan preset `veryfast`.
- [x] **Tahap 2: Auto Polish (Hook Banner, Viral Subtitle, Layout 9:16)**
  - Viral Subtitle: pemecah segmen transkrip 6–10 detik jadi 2–3 kata per baris proporsional berbasis durasi/karakter (`splitViralSubtitles`).
  - Bundle font tebal (Montserrat) di `storage/fonts/` & `frontend/public/fonts/`, load via `@font-face` di frontend dan `fontsdir` di ASS filter FFmpeg.
  - Layout 9:16: Full Crop vs Blur Background (stack video blur di belakang via FFmpeg split/boxblur/overlay).
  - Hook Banner: judul hook otomatis di atas frame klip (preview editor & FFmpeg burn-in ASS).
- [x] **Tahap 3: Multi-Cut Editor**
  - Timeline multi-segmen: potong intro/iklan membosankan di tengah klip, gabung beberapa bagian klip jadi satu video utuh (`cuts` array di API config, multi-trim concat FFmpeg, dan UI timeline segmen di editor).

### Fase 8: AI Auto-Editor & Studio Layout
- [x] Sumber & Audio: format yt-dlp `bv*[height<=1440]+ba/b` + merge mp4, renderer `-sws_flags lanczos`, `-crf 18`, dan normalisasi audio `-af loudnorm=I=-14:TP=-1.5:LRA=11`.
- [x] AI Editorial Plan: skema `auto_edit` di 9router & validator (`hook_banner_text`, `recommended_layout`, `highlight_keywords`).
- [x] Autonomous Auto-Editor Agent (Jalur 1): Sub-agent Vision Framing (`visionFramer.js`, ekstrak 3 frame sampel, tentukan layout 9:16 & `crop_x`) + Sub-agent Semantic Pacing (`semanticPacer.js`, Cue-ID Anchoring, pangkas filler/basa-basi).
- [x] Inisialisasi Cuts Mulus: klip dimulai dengan 1 segmen utuh `[0..durationSec]` (tanpa potongan jump-cut paksa) sehingga klip berjalan natural sejak awal.
- [x] Modern CapCut-Style Timeline: toolbar ringkas (Play/Pause `Space`, Split `S`, Delete/Restore, Undo `Ctrl+Z`, badge durasi), interactive ruler & draggable playhead, video track dengan drag-to-trim handle kiri/kanan & seleksi segmen aktif/nonaktif, serta mini subtitle track.
- [x] Sanitasi ASS & Posisi Subtitle: Perbaikan bug artefak `12)}`, sanitasi teks banner/subtitle, pengaturan posisi vertikal (Atas/Tengah/Bawah) dengan MarginV presisi, sinkronisasi delay (kompensasi lead -0.18s + slider `subtitle_offset_sec`), dan pencabutan batasan durasi kaku (bebas berapapun sesuai konteks >= 3s).
- [x] Multi-Aspect Ratio & Blur Background: Dukungan rasio aspek `9:16`, `1:1`, `4:3`, `16:9` dengan dynamic canvas, mode `blur_bg` (`gblur=sigma=35,eq=brightness=-0.12` di FFmpeg dan video background blur di preview), kontrol ukuran font `subtitle_font_size` (32..96, default 64), dan edit teks subtitle per baris cue secara instan.
- [x] 6 Font Viral & Caption Gen Z: Bundle 6 font open-source TTF (Montserrat, Poppins, Anton, Bebas Neue, Oswald, Plus Jakarta Sans), pemilih font terpisah untuk `hook_font` dan `subtitle_font`, normalisasi path Windows `fontsdir`, AI caption generator Gen Z + 3 hashtag dengan endpoint `POST /api/clips/{id}/caption`, dan 1-click copy caption di UI.
- [x] Fix Regenerate Caption, Auto-Save & Video Preview Stability: `services.ninerouter` fallback baca root `.env`, `temperature: 0.85` tanpa template statis + HTTP 502 error handling, `AbortController` + debounce 800ms + `withoutMiddleware('throttle')` pada `PATCH /api/clips/{id}/config`, serta single-stream `<video>` + `<canvas>` blur background untuk mencegah bottleneck `php artisan serve`.
- [x] Verifikasi: PHPUnit 42/42 PASS, worker node test 87/87 PASS, frontend build PASS.

---

## 5. Log Keputusan Teknis (ADR)
- `2026-11-20`: Menggunakan **9router** untuk fleksibilitas routing & fallback LLM murah ber-context panjang.
- `2026-11-20`: Menetapkan **Segment-ID Anchoring** (`[S{id}|{detik}]`) untuk menghilangkan halusinasi timestamp LLM.
- `2026-11-20`: Memisahkan `worker/` (Node.js) dari `backend/` agar mudah dipindahkan ke VPS khusus FFmpeg saat produksi.
- `2026-11-20`: 9router dipakai secara lokal melalui `http://localhost:20128/v1`; combo `bansossss` dapat mengembalikan SSE walau request `stream: false`, jadi worker mem-parsing respons JSON dan SSE.
- `2026-11-20`: DB development lokal = XAMPP MariaDB 10.4 di `127.0.0.1:3307` (bukan 3306), database `x7clip`, user `root` tanpa password; `backend/.env` dan `phpunit.xml` memakai koneksi ini.
- `2026-11-20`: Path subtitle relatif selalu di-resolve terhadap root proyek, bukan current working directory worker, agar runtime CLI menyimpan output di `storage/transcripts/`.
- `2026-11-20`: Job queue Backend -> Worker memakai list Redis mentah `x7:jobs` berisi JSON `{"type":"analyze_project","project_id":<id>,"attempt":1}` (bukan payload queue Laravel). Client Redis = `predis/predis` karena ekstensi phpredis tidak tersedia di PHP XAMPP.
- `2026-11-20`: `REDIS_PREFIX=` dikosongkan agar predis tidak menambah prefix diam-diam; key `x7:jobs` dibaca persis sama oleh `BRPOP` Node (diverifikasi `redis-cli keys *jobs*`).
- `2026-11-20`: Worker update DB langsung (Opsi A) lewat satu modul `worker/src/db.js` (`mysql2/promise`) supaya mudah diganti HTTP callback bila worker dipisah ke VPS. Insert `clips` + `projects.status='ready'` dalam satu transaksi, `created_at`/`updated_at` = `NOW()`, kolom JSON via `JSON.stringify()`.
- `2026-11-20`: `phpunit.xml` mengarah ke database test terpisah `x7clip_test` (host 127.0.0.1:3307) agar `RefreshDatabase` tidak menghapus data riil `x7clip`.
- `2026-11-20`: Retry job analisis maks 3 attempt (`attempt` di payload); gagal -> `status=failed` + `error_message`, retry -> `status=queued` + requeue ke `x7:jobs`.
- `2026-11-20`: `ninerouter.js` membaca body respons sebagai teks lalu coba `JSON.parse`, fallback `parseResponseText` (SSE). Sebelumnya `response.json()` throw saat 9router kirim body SSE walau `content-type: application/json`; error itu ditelan loop chunk sehingga project bisa `ready` dengan `clips=0`.
- `2026-11-20`: `consumer.js` wajib `throw` jika SEMUA chunk gagal dianalisis (masuk retry/failed + `error_message`), supaya kegagalan 9router tidak pernah tersamar jadi `status=ready` tanpa klip. `clips=0` hanya sah jika AI benar-benar mengembalikan `"clips": []`.
- `2026-11-20`: Pool `mysql2` menyetel `charset: 'UTF8MB4_UNICODE_CI'` eksplisit (nama collation, bukan `'utf8mb4'` yang ditolak mysql2) agar judul/caption ber-emoji aman di MariaDB `utf8mb4`.
- `2026-11-20`: Agent DILARANG menjalankan daemon (`node src/consumer.js`, `php artisan serve`, dll.) via shell tool; user menjalankannya manual di terminal terpisah (Bagian 2 item 7).
- `2026-11-20`: Persiapan klip dilacak di `clips.prepare_status` (`idle|preparing|ready|failed`) + `prepare_error`. `POST /api/clips/{id}/prepare` idempoten: `ready` + file ada -> 200 tanpa re-clip; `preparing` -> 202 tanpa push; selain itu set `preparing` + push job `{"type":"prepare_clip","clip_id":N}` -> 202; gagal enqueue -> 503 + `failed`.
- `2026-11-20`: File klip mentah deterministik `storage/raw-clips/clip-<clipId>.mp4` (pass `clipId` ke `clipSegment`) supaya cek idempoten cukup `is_file(raw_clip_path)`. Subtitle klip disimpan di `clips.subtitle_json` hasil `shiftSubtitles` (mulai `00:00`).
- `2026-11-20`: `GET /api/clips/{id}/video` memakai `response()->file()`; Symfony `BinaryFileResponse` sudah menangani `Range` -> 206 (`Content-Range`, `Accept-Ranges: bytes`) tanpa kode manual.
- `2026-11-20`: `phpunit.xml` memakai `REDIS_DB=15` agar test tidak berebut list `x7:jobs` dengan consumer development di DB 0 (sebelumnya job test bisa langsung dimakan consumer).
- `2026-11-21`: `PATCH /api/clips/{id}/config` menerima `edit_config` (partial merge ke `edit_config_json` lama) + `subtitles` (replace penuh). Validasi: `aspect_ratio` `16:9|9:16`, `crop_x` `0..1`, `font_size` `8..200`, `trim_start/trim_end` harus dalam durasi klip (`end_sec - start_sec`) dan `trim_end > trim_start`, tiap subtitle `end > start`. Respons 200 mengembalikan `edit_config_json` + `subtitle_json`; `GET /api/projects/{id}` juga mengekspos keduanya agar editor bisa memuat state.
- `2026-11-21`: `POST /api/clips/{id}/render` membuat `render_jobs` (`queued`, `progress_percent=0`) lalu push `{"type":"render_clip","render_job_id":N,"clip_id":N}` ke `x7:jobs` → 202. Job `queued|rendering` yang masih aktif dipakai ulang (202, tanpa push) agar klik Export berulang tidak menggandakan render. Klip belum siap (`prepare_status!=ready` atau file mentah hilang) → 409. Gagal enqueue -> 503 + job `failed`. `GET /api/render-jobs/{id}` mengembalikan `status`/`progress_percent`/`output_url`/`error_message`.
- `2026-11-21`: Renderer selalu men-scale output ke resolusi tetap (`1920x1080` untuk 16:9, `1080x1920` untuk 9:16) dan ASS memakai `PlayResX/Y` yang sama, supaya ukuran font/posisi subtitle konsisten dengan preview. Crop 9:16: `crop=w='trunc(ih*9/32)*2':x='trunc((iw-ih*9/16)*crop_x)'` lalu `scale=1080:1920`.
- `2026-11-21`: `renderClip` dipisah jadi fungsi murni (`buildArgs`, `buildFilters`, `parseProgressPercent`, `trimRange`) + runner `spawn` agar testable tanpa FFmpeg. Progres dibaca dari `-progress pipe:1` (`out_time_ms`/`out_time`), di-throttle tiap 5% di consumer dan nilai mundur diabaikan. Output `storage/exports/clip-<clipId>-render-<jobId>.mp4`, `output_url` disimpan relatif terhadap root proyek. File ASS sementara di `storage/tmp/` dihapus setelah render.
- `2026-11-21`: Konkurensi render dibatasi via `RENDER_CONCURRENCY` (default `1`, clamp `1..2`) + limiter internal (`createLimiter`). Job `render_clip` dijalankan di lane sendiri sehingga tidak memblokir `analyze_project`/`prepare_clip`; shutdown menunggu render aktif (`Promise.allSettled`) sebelum menutup DB.
- `2026-11-21`: Fase 6 Tahap 1 (Fix Resolusi): yt-dlp diset `bv*[height<=1440]+ba/b` dengan `--merge-output-format mp4` di `clipper.js`. Di `renderer.js`: `-sws_flags lanczos` dan `-crf 18` untuk ketajaman scale 9:16 (1080x1920) optimal tanpa beban decode 4K AV1.
- `2026-11-21`: Eliminasi bug artefak `12)}`: banner hook dipindahkan ke `Style: Banner` terpisah tanpa override tag `\pos(...)`. Sanitasi `sanitizeAssText` menghapus kurung kurawal pembuka/penutup dan backslash mentah.
- `2026-11-21`: Posisi subtitle vertikal didukung (`top`: MarginV=160/340, `middle`: MarginV=0, `bottom`: MarginV=240) dan sinkronisasi delay diperbaiki dengan kompensasi lead `-0.18s` plus slider `subtitle_offset_sec` (`-2s..+2s`). Batasan durasi klip maksimal dicabut; klip utuh sesuai konteks `>= 3s`.
- `2026-11-21`: Multi-Aspect Ratio (`9:16`, `1:1`, `4:3`, `16:9`) didukung penuh di backend (`ClipController`), renderer FFmpeg (`outputDimensions` & dynamic crop/scale), dan preview canvas frontend. Mode `blur_bg` menerapkan background video blur di preview dan FFmpeg `split=2`, `gblur=sigma=35,eq=brightness=-0.12`, `overlay` di renderer. `subtitle_font_size` (32..96, default 64) diskala proporsional di preview dan output `.ass`, serta cue subtitle baris demi baris dapat diedit langsung.
- `2026-11-21`: Font viral (6 font open-source TTF) di-bundle di `storage/fonts/` dan `frontend/public/fonts/`, nama keluarga internal dibaca langsung dari tabel OpenType `name`, pemilih font terpisah untuk `hook_font` dan `subtitle_font`, generator caption AI Gen Z + 3 hashtag via `POST /api/clips/{id}/caption`, dan 1-click clipboard copy di UI Web Editor.
- `2026-11-21`: Eliminasi bottleneck dual-stream `<video>` pada `blur_bg` dengan memakai 1 `<video>` utama + `<canvas>` snapshot blur, `isSeekingRef` guard pada auto-skip, `AbortController` + debounce 800ms + `withoutMiddleware('throttle')` untuk auto-save `PATCH /api/clips/{id}/config`, serta fallback konfigurasi 9router ke `base_path('../.env')` dan status `502` eksplisit saat `POST /api/clips/{id}/caption` gagal.
- *(Agent: tambahkan catatan keputusan baru atau temuan bug penting di baris bawah ini)*

---

## 6. Status Terakhir & Handoff Log

- **Fase Aktif:** Fase 8 (Stabilitas Editor, Auto-Save & Regenerate Caption 9router) — Selesai Penuh
- **Tugas Terakhir Selesai:**
  - `services.ninerouter` di Laravel otomatis fallback membaca root `.env` (`base_path('../.env')`); `ClipController@generateCaption` memanggil `/chat/completions` dengan `temperature: 0.85` tanpa fallback template hardcoded, dan mengembalikan `502` jelas jika 9router gagal.
  - Auto-save `Editor.jsx` memakai `AbortController` + debounce `800ms`, clamping ketat, indikator error detail + tombol `Coba Lagi`, serta `withoutMiddleware('throttle')` di `routes/api.php`.
  - Video preview `blur_bg` hanya menggunakan 1 elemen `<video>` + `<canvas>` background blur, `isSeekingRef` guard untuk auto-skip, dan pembersihan output buffer di `GET /api/clips/{id}/video`.
  - Verifikasi: PHPUnit 42/42 PASS, worker node test 87/87 PASS, frontend build PASS.
- **Tugas Berikutnya:** Semua perbaikan tuntas dan siap digunakan.
- **File Terakhir Diubah:** `backend/config/services.php`, `backend/.env.example`, `backend/app/Http/Controllers/Api/ClipController.php`, `backend/routes/api.php`, `backend/tests/Feature/Api/ClipCaptionApiTest.php`, `frontend/src/{components/Editor.jsx,api.js}`, `AGENTS.md`, `docs/progress.md`.
- **Blocker / Catatan:** Seluruh test unit & feature PASS: `php artisan test` PASS 42/42 (191 assertions), `npm test` (worker) PASS 87/87, `npm run build` PASS.
