# x7clipper — AI Video Clipper & Auto-Editor

Ubah video YouTube atau berkas video panjang menjadi klip video pendek (TikTok, Instagram Reels, YouTube Shorts) siap tayang secara otomatis. Sistem mengekstrak transkrip, menganalisis momen terbaik dengan **Segment-ID Anchoring** via **9router AI Gateway**, memotong video parsial tanpa mengunduh video utuh, menjalankan **Autonomous Auto-Editor Agent** (Vision Framing & Semantic Pacing), lalu menyediakannya di **Web Editor Studio (CapCut-style)** untuk kustomisasi instan sebelum di-render ke resolusi tinggi dengan FFmpeg.

![PHP](https://img.shields.io/badge/PHP-8.2+-777BB4?logo=php&logoColor=white)
![Laravel](https://img.shields.io/badge/Laravel-12-FF2D20?logo=laravel&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4-38B2AC?logo=tailwind-css&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB%2FMySQL-10.4%2B-003545?logo=mariadb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-6+-007808?logo=ffmpeg&logoColor=white)

---

## Fitur Utama

### 1. AI Moment Selection (Anti-Halusinasi Timestamp)
- **Segment-ID Anchoring:** LLM hanya boleh merujuk ID segmen kalimat yang terverifikasi (`[S12|83] ...`), bukan mengarang detik mentah.
- **Sliding Window Chunking:** Video < 20 menit dianalisis 1 request; video ≥ 20 menit dipecah per 15 menit dengan overlap 2 menit dan deduplikasi cerdas (overlap > 50% memprioritaskan `viral_score` tertinggi).
- **Safety Padding:** Otomatis menambahkan buffer `-0.35s` di awal dan `+0.50s` di akhir klip agar kalimat pembicara tidak terpotong.

### 2. Autonomous Auto-Editor Agent
- **Vision Framing Sub-Agent:** Ekstraksi 3 frame visual (15%, 50%, 85%) dikirim ke `NINEROUTER_VISION_MODEL` untuk mendeteksi layout terbaik (`full_crop` vs `blur_bg`) dan posisi tengah subjek `crop_x` (0.0–1.0) dengan fallback aman.
- **Semantic Pacing Sub-Agent:** Cue-ID Anchoring (`[C1|0.00-3.45]`) mendeteksi jeda hening dan membuang filler/basa-basi tanpa merusak alur cerita.
- **Inisialisasi Mulus:** Klip dimulai sebagai 1 segmen utuh `[0..durationSec]` tanpa potongan jump-cut paksa.
- **Konteks Bebas (Tanpa Batasan Durasi Kaku):** AI memilih klip tuntas sesuai konteks (durasi minimal ≥ 3 detik, tanpa pembatasan kaku 58s/110s).

### 3. Studio Web Video Editor (Gaya CapCut Web)
- **Interactive Multi-Cut Timeline:**
  - Toolbar ringkas: Play/Pause (`Space`), Split di playhead (`S`), Hapus/Pulihkan segmen (`Delete`/`Backspace`), Undo (`Ctrl+Z`), indikator total durasi.
  - Interactive ruler & draggable playhead dengan scrubbing real-time dan tooltip waktu.
  - Video track dengan *trim handle* kiri/kanan pada setiap segmen aktif, klik untuk seleksi segmen, dan tampilan arsir redup untuk segmen nonaktif (auto-skip saat pemutaran).
  - Mini subtitle track di bawah video track untuk memandu titik potong di antara jeda kalimat.
- **Canvas Preview Dinamis:**
  - Pratinjau langsung 4 rasio aspek (`9:16`, `1:1`, `4:3`, `16:9`).
  - Mode **Blur Background (`blur_bg`)**: Layer video blur sekunder di belakang (`blur-xl brightness-75`) yang sinkron dengan video utama di tengah.
  - Mode **Full Crop**: Drag-to-pan langsung pada canvas untuk menggeser posisi horizontal `crop_x`.
- **Panel Bertab Rapi:**
  - **Gaya & Hook:** Pemilih Rasio Aspek, mode tata letak, input Hook Banner, pemilih font Hook Banner, dan 3 preset 1-klik (*Hormozi*, *Podcast*, *Breaking*).
  - **Subtitle:** Pemilih font subtitle, 3 tombol posisi vertikal (Atas/Tengah/Bawah dengan margin aman di bawah banner), slider ukuran font (32–96) dengan 4 preset cepat (Kecil 44, Sedang 64, Besar 78, Jumbo 92), slider sinkronisasi delay (-2.0s s/d +2.0s), dan daftar baris cue yang dapat diedit langsung.
  - **Export:** Ringkasan spesifikasi render, progress bar polling real-time, tombol unduh `.mp4`, dan panel Rekomendasi Caption Gen Z + 3 hashtag dengan tombol 1-klik Salin Caption & Buat Ulang Caption.
- **Debounced Auto-Save:** Setiap perubahan disimpan otomatis ke database tanpa tombol simpan manual.

### 4. 6 Pilihan Font Viral Open-Source
Tersedia 6 font TTF tebal di `storage/fonts/` dan `frontend/public/fonts/` dengan pembaca tabel OpenType `name` di worker dan `@font-face` di browser:
1. **Montserrat ExtraBold** (`Montserrat-ExtraBold.ttf`)
2. **Poppins Black** (`Poppins-Black.ttf`)
3. **Anton** (`Anton-Regular.ttf`)
4. **Bebas Neue** (`BebasNeue-Regular.ttf`)
5. **Oswald Bold** (`Oswald-Bold.ttf`)
6. **Plus Jakarta Sans ExtraBold** (`PlusJakartaSans-ExtraBold.ttf`)

### 5. Final Render Engine FFmpeg
- **Resolusi Tinggi:** Sumber yt-dlp `bv*[height<=1440]+ba/b` dimuat ke AVC/MP4 cepat, scaling lanczos (`flags=lanczos`), dan `-crf 18`.
- **Audio Broadcast Broadcast:** Normalisasi audio `-af loudnorm=I=-14:TP=-1.5:LRA=11` (standar media sosial -14 LUFS) pada single clip maupun multi-cut concat.
- **Burn-In ASS Subtitle:** Penskalaan font dan MarginV proporsional resolusi output, highlight kata viral warna kontras (`#FFE600`), bebas dari artefak tag rusak `12)}`.
- **Batas Konkurensi & Scheduled Cleanup:** Render dibatasi 1–2 job simultan (`RENDER_CONCURRENCY=1`), dan cleanup otomatis menghapus file sementara > 24 jam.

### 6. Riwayat Proyek & URL State Persistence
- Riwayat 20 proyek terbaru dengan badge status, jumlah klip, tombol buka, dan tombol hapus cascade.
- URL routing sinkron (`/projects/:id` dan `/projects/:id/clips/:id`) sehingga me-refresh halaman (F5) tidak menghilangkan state editor dan polling otomatis dilanjutkan (*auto-resume*).
- Fallback upload video lokal MP4/MOV + subtitle VTT/SRT jika IP server terkena batasan/blokir YouTube.

---

## Arsitektur Sistem

```text
┌─────────────────────────────────────────────────────────────┐
│                   Frontend (React + Vite)                   │
│   Canvas Preview, CapCut Timeline, Tab Panels, URL Routing  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP REST API
┌──────────────────────────────▼──────────────────────────────┐
│                  Backend (Laravel 12 API)                   │
│     Validasi, Database Models, Dispatcher Redis Queue       │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │ LPUSH (x7:jobs)
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      MariaDB / MySQL         │ │       Redis Server         │
│  projects, clips, render_jobs│ │  Queue: "x7:jobs"          │
└──────────────▲───────────────┘ └────────────┬───────────────┘
               │                              │ BRPOP
┌──────────────┴──────────────────────────────▼───────────────┐
│                    Worker (Node.js LTS)                     │
│  - yt-dlp & FFmpeg smart clipper (1440p, loudnorm, lanczos) │
│  - 9router AI Gateway (Analisis, Caption Gen Z, Vision)     │
│  - Autonomous Auto-Editor Agent (Vision Framing, Pacing)    │
│  - ASS Subtitle Generator & Final Render Engine             │
└─────────────────────────────────────────────────────────────┘
```

---

## Struktur Folder

```text
x7clipper/
├── backend/                   # REST API Laravel 12
│   ├── app/Http/Controllers/Api/  # ProjectController, ClipController, RenderJobController
│   ├── app/Models/            # Project, Clip, RenderJob
│   ├── routes/api.php         # Rute API publik
│   └── tests/Feature/Api/     # Feature tests PHPUnit (41 tests)
├── worker/                    # Media processing & AI worker Node.js
│   ├── src/
│   │   ├── consumer.js        # Redis queue runner (analyze, prepare, render)
│   │   ├── clipper.js         # yt-dlp download sections + FFmpeg re-encode
│   │   ├── renderer.js        # Multi-cut, crop/blur filter, burn-in ASS, loudnorm
│   │   ├── fonts.js           # OpenType name reader & 6 font mapping
│   │   ├── subtitleShift.js   # Lead compensation, sanitasi ASS, split viral
│   │   ├── ninerouter.js      # OpenAI-compatible client (chat & caption)
│   │   ├── validator.js       # Zod schema validation & deduplikasi
│   │   ├── agents/
│   │   │   ├── perception.js      # Frame extraction (15%, 50%, 85%) & Cue-ID
│   │   │   ├── visionFramer.js    # Sub-agent layout & crop_x via Vision AI
│   │   │   ├── semanticPacer.js   # Sub-agent cut semantik & pacing
│   │   │   └── autoEditorAgent.js # Orchestrator Auto-Editor
│   │   └── db.js              # Database connection & transactional updates
│   ├── scripts/               # healthcheck.js, cleanup.js
│   └── test/                  # Unit tests node:test (87 tests)
├── frontend/                  # Web Video Editor React + Vite + Tailwind
│   ├── src/
│   │   ├── components/
│   │   │   ├── Editor.jsx     # Studio Layout Video Editor
│   │   │   ├── ClipList.jsx   # Daftar rekomendasi klip
│   │   │   └── StatusTracker.jsx # Visual pipeline tracker
│   │   ├── App.jsx            # Routing, history, dan upload form
│   │   └── api.js             # HTTP API client
│   └── public/fonts/          # Bundle 6 file font TTF
├── storage/                   # Runtime directories (gitignored)
│   ├── fonts/                 # Shared 6 font TTF
│   ├── raw-clips/             # Video potongan parsial
│   ├── transcripts/           # Cache transkrip subtitle
│   ├── tmp/                   # File temp download & ASS
│   ├── uploads/               # Upload video lokal
│   └── exports/               # Video final hasil render
├── PRD.md                     # Dokumen spesifikasi produk
├── AGENTS.md                  # Panduan coding agent & ADR
└── docs/                      # progress.md, RUNNING.md
```

---

## Konfigurasi Lingkungan (`.env`)

Salin `.env.example` ke `.env` di root proyek:

```env
# --- 9router (AI Gateway) ---
NINEROUTER_BASE_URL=http://localhost:20128/v1
NINEROUTER_API_KEY=your-9router-api-key
NINEROUTER_MODEL=bansossss
# Opsional: model khusus vision (otomatis fallback ke NINEROUTER_MODEL jika kosong)
NINEROUTER_VISION_MODEL=oc/mimo-v2.6-flash-free

# --- Redis (Queue Broker) ---
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# --- Database (MariaDB / MySQL) ---
DB_HOST=127.0.0.1
DB_PORT=3307
DB_DATABASE=x7clip
DB_USERNAME=root
DB_PASSWORD=

# --- External Binaries ---
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe

# --- Storage Paths ---
STORAGE_TMP=./storage/tmp
STORAGE_TRANSCRIPTS=./storage/transcripts
STORAGE_RAW_CLIPS=./storage/raw-clips
STORAGE_EXPORTS=./storage/exports
CLEANUP_MAX_AGE_HOURS=24

# --- Render Concurrency ---
RENDER_CONCURRENCY=1
```

### Konfigurasi Khusus Backend (`backend/.env`)
Pastikan konfigurasi Redis di `backend/.env` mengosongkan prefix:
```dotenv
REDIS_CLIENT=predis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PREFIX=
QUEUE_CONNECTION=redis
```
> **Penting:** `REDIS_PREFIX=` wajib dikosongkan agar key `x7:jobs` yang di-push oleh Laravel dibaca persis sama oleh worker Node (`BRPOP x7:jobs`).

---

## Menjalankan 4 Komponen Lokal

Untuk menjalankan sistem secara lengkap, buka terminal terpisah untuk setiap komponen:

### 1. Database & Redis Server
Pastikan MariaDB/MySQL (misal XAMPP port 3307 atau 3306) dan Redis Server (port 6379) sudah berjalan.
```bash
redis-cli ping
# Response: PONG
```

### 2. Backend API (Laravel)
```bash
cd backend
composer install
php artisan migrate
php artisan serve --port=8000
# Berjalan di: http://127.0.0.1:8000
```

### 3. Media & AI Worker (Node.js)
```bash
cd worker
npm install
npm run consumer
# Berjalan mendengarkan antrean x7:jobs
```

### 4. Frontend Web Editor (React + Vite)
```bash
cd frontend
npm install
npm run dev
# Buka di browser: http://localhost:5173
```

---

## Daftar Endpoint REST API

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/projects` | Mengambil 20 proyek terbaru beserta `clips_count` |
| `POST` | `/api/projects` | Memvalidasi URL YouTube & mengantrekan analisis |
| `POST` | `/api/projects/upload` | Mengunggah video MP4 lokal + subtitle VTT/SRT |
| `GET` | `/api/projects/{id}` | Mengambil detail proyek, status pipeline, & daftar klip |
| `DELETE` | `/api/projects/{id}` | Menghapus proyek beserta seluruh klip & render job-nya |
| `POST` | `/api/clips/{id}/prepare` | Mengantrekan smart clipping & auto-editor (`force: true` didukung) |
| `GET` | `/api/clips/{id}/video` | Streaming video potongan klip (mendukung HTTP 206 Range) |
| `PATCH` | `/api/clips/{id}/config` | Menyimpan `edit_config_json`, `subtitles`, & `suggested_caption` |
| `POST` | `/api/clips/{id}/caption` | Membuat / meregenerasi rekomendasi caption Gen Z + 3 hashtag |
| `POST` | `/api/clips/{id}/render` | Mengantrekan render FFmpeg final |
| `GET` | `/api/render-jobs/{id}` | Mengambil status dan persentase progres render (0–100%) |
| `GET` | `/api/render-jobs/{id}/download` | Mengunduh file `.mp4` hasil render final |

---

## Menjalankan Pengujian (Testing)

Seluruh pengujian unit dan integrasi dapat dijalankan dengan perintah berikut:

### 1. Worker Test Suite (Node.js native runner)
```bash
cd worker
npm test
# Hasil: 87 tests passed (0 fail, 0 skipped)
```

### 2. Backend Test Suite (PHPUnit / Pest)
```bash
cd backend
php artisan test
# Hasil: 41 tests passed (189 assertions)
```

### 3. Frontend Build Verification (Vite)
```bash
cd frontend
npm run build
# Hasil: ✓ built in ~1.5s (33 modules)
```

### 4. Maintenance / Scheduled Cleanup
Untuk membersihkan file sementara berusia > 24 jam:
```bash
cd worker
npm run cleanup
# Opsi dry-run: npm run cleanup -- --dry-run
```
