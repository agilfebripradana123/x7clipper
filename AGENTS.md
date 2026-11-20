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
- [ ] Buat migrasi & model database untuk `projects`, `clips`, dan `render_jobs` sesuai `PRD.md`.
- [ ] Buat endpoint `POST /api/projects` (validasi URL -> simpan project -> push job analisis ke Redis).
- [ ] Buat endpoint `GET /api/projects/{id}` (kembalikan status pipeline + daftar `clips`).
- [ ] Buat endpoint `POST /api/clips/{id}/prepare` (push job smart clipping untuk klip yang dipilih user).
- [ ] Buat endpoint `PATCH /api/clips/{id}/config` (simpan `edit_config_json` dan revisi `subtitle_json`).
- [ ] Buat endpoint `POST /api/clips/{id}/render` dan `GET /api/render-jobs/{id}` (antrean render final + polling progres).
- [ ] Hubungkan consumer Redis Queue di `worker/` agar mendengarkan job dari Backend dan mengupdate status/progres ke API/DB.

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
- `2026-11-20`: Path subtitle relatif selalu di-resolve terhadap root proyek, bukan current working directory worker, agar runtime CLI menyimpan output di `storage/transcripts/`.
- *(Agent: tambahkan catatan keputusan baru atau temuan bug penting di baris bawah ini)*

---

## 6. Status Terakhir & Handoff Log

- **Fase Aktif:** Fase 3 (Backend API, Database & Redis Queue)
- **Tugas Terakhir Selesai:** Verifikasi pemutaran klip browser & sinkronisasi audio/subtitle (Fase 2 tuntas 100%).
- **Tugas Berikutnya:** Migrasi & model database `projects`, `clips`, `render_jobs` sesuai `PRD.md` (Fase 3 - Item 1).
- **File Terakhir Diubah:** `worker/src/youtube.js`, `worker/test/youtube.test.js`, `docs/progress.md`, `AGENTS.md`.
- **Blocker / Catatan:** Fase 2 tuntas: smart clipping `yt-dlp` parsial, re-encode FFmpeg faststart + keyframe bersih di 0.04s, audio start 0.00s, subtitle shift ke 00:00 (SRT/JSON), test 34/34 pass. Siap masuk Fase 3.