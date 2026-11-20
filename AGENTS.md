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
- [ ] Buat endpoint `POST /api/clips/{id}/prepare` (push job smart clipping untuk klip yang dipilih user).
- [ ] Buat endpoint `PATCH /api/clips/{id}/config` (simpan `edit_config_json` dan revisi `subtitle_json`).
- [ ] Buat endpoint `POST /api/clips/{id}/render` dan `GET /api/render-jobs/{id}` (antrean render final + polling progres).
- [x] Hubungkan consumer Redis Queue di `worker/` agar mendengarkan job dari Backend dan mengupdate status/progres ke API/DB.

### Fase 4: Frontend & Web Video Editor
- [ ] Setup React + Vite + Tailwind + API client dan halaman Input URL YouTube + status tracker pipeline.
- [ ] Buat halaman Daftar Rekomendasi Klip (tampilkan judul, `viral_score`, `hook_type`, alasan AI, durasi, dan tombol "Edit Klip").
- [ ] Buat komponen Web Editor: HTML5 `<video>` player + dual-handle slider trim start/end.
- [ ] Buat kontrol rasio aspek (`16:9` / `9:16`) dengan overlay frame crop yang bisa digeser horizontal (simpan `crop_x` dalam `0.0 - 1.0`).
- [ ] Buat panel editor teks subtitle + live caption overlay di atas video player.
- [ ] Hubungkan tombol "Export / Render Final" dengan progress bar polling dan tombol download `.mp4`.

### Fase 5: Final Render Engine & Hardening
- [ ] Buat `worker/src/renderer.js`: builder perintah FFmpeg untuk `trim` + `crop 9:16` (hitung dari rasio `crop_x`) + `burn-in` subtitle `.ass` dengan font identik frontend + parser progres persen FFmpeg.
- [ ] Terapkan batas konkurensi worker render (maks 1–2 job simultan).
- [ ] Buat scheduled cleanup job untuk menghapus file sementara di `storage/tmp/` dan `storage/raw-clips/` yang berusia > 24 jam.
- [ ] Tambahkan endpoint & UI cadangan: Upload file MP4 lokal (fallback jika IP server terkena blokir YouTube).

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
- *(Agent: tambahkan catatan keputusan baru atau temuan bug penting di baris bawah ini)*

---

## 6. Status Terakhir & Handoff Log

- **Fase Aktif:** Fase 3 (Backend API, Database & Redis Queue)
- **Tugas Terakhir Selesai:** E2E riil 1 URL (`hXOo7FdQVrk`, 1104s) via Laravel -> Redis -> consumer -> 9router -> MariaDB: project `ready` + 4 klip tersimpan. Sekalian fix `ninerouter.js` (parse body teks + fallback SSE) dan guard `consumer.js` (semua chunk gagal -> throw, bukan `ready` + 0 klip). `charset` mysql2 eksplisit `UTF8MB4_UNICODE_CI`.
- **Tugas Berikutnya:** `POST /api/clips/{id}/prepare` idempoten + kolom `prepare_status`/`prepare_error`, plus `GET /api/clips/{id}/video` (`response()->file()`, dukung Range 206) — Fase 3 Item 4.
- **File Terakhir Diubah:** `worker/src/{ninerouter,consumer,db}.js`, `worker/test/ninerouter.test.js`, `AGENTS.md`.
- **Blocker / Catatan:** `npm test` PASS 40/40. Verifikasi E2E: requeue project 8 via `x7:jobs` -> `analyzing` -> `ready` + 4 klip. 9router saat dicek membalas `application/json` normal; kegagalan lama tidak terekam karena log consumer user tidak tersimpan (indikasi kuat: respons 9router gagal parse/HTTP error lalu di-skip diam-diam). Consumer user (PID baru) sudah memakai kode fix.