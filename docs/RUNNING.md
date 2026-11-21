# Menjalankan Sistem (Development)

Panduan operasional x7clipper: dari nol sampai bisa menganalisis video, menyiapkan klip,
dan merender hasil final. Semua perintah ditulis untuk **Windows PowerShell**; versi
Unix hanya berbeda pada cara menyalin file dan variabel environment.

Sistem terdiri dari 4 proses yang harus jalan bersamaan:

| Proses | Port | Perintah |
|---|---|---|
| Redis | 6379 | service Redis (mis. via Memurai/WSL/Docker) |
| MariaDB/MySQL | 3307 (dev lokal) | service database (mis. XAMPP) |
| Laravel API | 8000 | `php backend/artisan serve --host=127.0.0.1 --port=8000` |
| Worker Node (consumer Redis) | - | `npm run consumer` di `worker/` |
| Frontend Vite | 5173 | `npm run dev` di `frontend/` |

> Backend **tidak** memakai queue Laravel. Job disimpan sebagai list Redis mentah `x7:jobs`
> dan diproses `worker/src/consumer.js`. Jangan menjalankan `php artisan queue:work`.

---

## 1. Prasyarat

- PHP **8.2+** + Composer (Laravel 12)
- Node.js **20+** (dikembangkan di Node 24)
- MariaDB **10.4+** / MySQL **8**
- Redis **7** di `127.0.0.1:6379`
- `yt-dlp`, `ffmpeg`, `ffprobe` terpasang dan bisa dipanggil dari `PATH`
  (atau isi path absolutnya di `.env`)
- Endpoint 9router (OpenAI-compatible) + API key + model ID

Cek binary:

```powershell
yt-dlp --version
ffmpeg -version
ffprobe -version
```

---

## 2. Environment

Ada **dua** file env terpisah:

| File | Dibaca oleh | Isi |
|---|---|---|
| `backend/.env` | Laravel API | DB, Redis, app key |
| `.env` (root proyek) | Worker Node | 9router, DB, Redis, path binary, storage |

### 2.1 `backend/.env`

```powershell
Copy-Item backend/.env.example backend/.env
php backend/artisan key:generate
```

Nilai minimal:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3307          # sesuaikan: XAMPP dev lokal di 3307, MySQL standar 3306
DB_DATABASE=x7clip
DB_USERNAME=root
DB_PASSWORD=

REDIS_CLIENT=predis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PREFIX=
```

Catatan: `predis/predis` dipakai karena ekstensi `phpredis` belum tentu ada.
`REDIS_PREFIX` **harus kosong** agar Laravel dan Node membaca key `x7:jobs` yang sama.

### 2.2 `.env` root (worker)

```powershell
Copy-Item .env.example .env
```

Nilai minimal:

```dotenv
NINEROUTER_BASE_URL=http://127.0.0.1:20128/v1
NINEROUTER_API_KEY=sk-...
NINEROUTER_MODEL=your-model-id

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

DB_HOST=127.0.0.1
DB_PORT=3307
DB_DATABASE=x7clip
DB_USERNAME=root
DB_PASSWORD=

YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
SUBTITLE_FONT=Arial
RENDER_CONCURRENCY=1   # 1..2, jumlah render FFmpeg simultan
```

Path binary boleh nama perintah (`ffmpeg`) atau path absolut Windows, mis.
`C:\...\ffmpeg.exe` (pakai backslash, tanpa tanda kutip).

---

## 3. Setup sekali jalan

```powershell
composer --working-dir=backend install
npm --prefix worker install
npm --prefix frontend install

php backend/artisan migrate
```

Buat database kosong dulu (`x7clip`) di MariaDB/MySQL sebelum `migrate`.

---

## 4. Healthcheck

```powershell
Set-Location worker
npm run healthcheck
```

Output diharapkan:

```text
PASS yt-dlp: ...
PASS ffmpeg: ...
PASS ffprobe: ...
PASS Redis: PONG
PASS 9router configuration: configured
```

Opsional, ikut menembak endpoint 9router (butuh kuota):

```powershell
$env:NINEROUTER_HEALTHCHECK='true'; npm run healthcheck
```

---

## 5. Menjalankan (butuh 4 terminal terpisah)

Urutan start: **Redis & DB hidup → API → consumer → frontend**. Jalankan tiap proses di
terminalnya sendiri; jangan di-background-kan lewat skrip/agent.

**Terminal 1 — API**

```powershell
php backend/artisan serve --host=127.0.0.1 --port=8000
```

**Terminal 2 — worker consumer**

```powershell
Set-Location worker
npm run consumer
# [11:15:14] consumer siap, BRPOP x7:jobs
```

**Terminal 3 — frontend**

```powershell
Set-Location frontend
npm run dev
# http://localhost:5173
```

Vite mem-proxy `/api` ke `http://127.0.0.1:8000`, jadi tidak perlu konfigurasi CORS.

**Terminal 4 — Redis & database** (kalau dijalankan manual, mis. `redis-server`/XAMPP).

> Worker memuat `.env` root saat start. Setelah mengubah kode worker atau `.env`,
> hentikan (`Ctrl+C`) lalu jalankan ulang `npm run consumer`. Job yang sudah terlanjur
> masuk `x7:jobs` tetap diproses setelah consumer hidup kembali.

---

## 6. Alur pemakaian di UI

1. Buka `http://localhost:5173`, tempel URL YouTube, klik **Mulai analisis**.
2. Pantau tracker: `Antrean → Ekstraksi → Analisis → Siap`.
   Status tersimpan di `projects.status`; halaman polling tiap 2 detik.
3. Di daftar **Rekomendasi klip**, klik **Edit Klip** → worker memotong segmen
   (`yt-dlp` + FFmpeg) dan menyimpan `subtitle_json`; kartu menunjukkan status
   `Menyiapkan → Siap`.
4. **Buka editor**: atur trim, rasio `16:9`/`9:16` + posisi crop, subtitle dan style.
5. Klik **Simpan** dulu, baru **Render final**. Render berjalan di worker FFmpeg;
   progress bar mengikuti `render_jobs.progress_percent`.
6. Setelah selesai, klik **Unduh video** (`/api/render-jobs/{id}/download`).

File runtime:

| Folder | Isi |
|---|---|
| `storage/transcripts/` | cache transkrip/subtitle |
| `storage/raw-clips/` | klip mentah `clip-<id>.mp4` |
| `storage/tmp/` | file sementara (ASS, unduhan parsial) |
| `storage/exports/` | hasil render `clip-<clipId>-render-<jobId>.mp4` |

---

## 7. Verifikasi cepat lewat API

```powershell
# gunakan curl.exe: alias `curl` di PowerShell 5.1 adalah Invoke-WebRequest
curl.exe -X POST http://127.0.0.1:8000/api/projects `
  -H "Content-Type: application/json" `
  -d '{"youtube_url":"https://www.youtube.com/watch?v=hXOo7FdQVrk"}'

curl.exe http://127.0.0.1:8000/api/projects/8
curl.exe -X POST http://127.0.0.1:8000/api/clips/11/prepare
curl.exe -X POST http://127.0.0.1:8000/api/clips/11/render
curl.exe http://127.0.0.1:8000/api/render-jobs/1
```

Status project: `queued → extracting → analyzing → ready | failed`.
Klip: `prepare_status` `idle|preparing|ready|failed`.
Render: `status` `queued|rendering|done|failed`.

Lihat antrean Redis:

```powershell
redis-cli llen x7:jobs
redis-cli lrange x7:jobs 0 -1
```

---

## 8. Test suite

```powershell
Set-Location backend; php artisan test
Set-Location ../worker; npm test
Set-Location ../frontend; npm run build
```

Test backend memakai database `x7clip_test` dan Redis DB 15 (lihat `phpunit.xml`),
terpisah dari data development. Pastikan `x7clip_test` sudah ada.
Jangan set `REDIS_DB=0` untuk test saat consumer development berjalan — job test bisa
dimakan consumer.

---

## 9. Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Project stuck `queued`, `redis-cli llen x7:jobs` naik | consumer mati / salah DB Redis | jalankan `npm run consumer`, cek `REDIS_*` di root `.env` |
| Consumer tidak memproses job tipe `render_clip` | consumer lama masih jalan | restart consumer agar handler baru ter-load |
| `Koneksi bermasalah` di UI | API mati atau port salah | cek terminal API, buka `http://127.0.0.1:8000/api/projects/1` |
| `Invalid URL` / 422 | URL bukan YouTube / video < 60 detik | pakai URL video valid ≥ 60 detik |
| Project `failed`, pesan 9router / JSON | API key, model, atau gateway lokal mati | cek `.env`, jalankan healthcheck dengan `NINEROUTER_HEALTHCHECK=true` |
| `Klip belum siap dirender` (409) | `prepare_status != ready` atau file mentah hilang | klik **Edit Klip** ulang, cek `storage/raw-clips/clip-<id>.mp4` |
| Video editor 404 | file mentah sudah dihapus / prepare gagal | cek `prepare_error` di respons `GET /api/projects/{id}` |
| Render `failed` | FFmpeg error (path, font, filter) | lihat `render_jobs.error_message`; cek `FFMPEG_PATH` dan font `SUBTITLE_FONT` |
| `Access denied` DB | port/database salah (3306 vs 3307) | samakan `DB_PORT` di `backend/.env` **dan** `.env` root |
| `phpredis` tidak ada | ekstensi tidak terpasang | biarkan `REDIS_CLIENT=predis` |
| Font unduhan berbeda dari preview | font host tidak sama | set `SUBTITLE_FONT` ke font yang terpasang; preview memakai `Arial` |

---

## 10. Catatan status

- Fase 0–4 selesai: pipeline analisis, prepare klip, editor (trim/crop/subtitle), render + unduh.
- Fase 5: batas konkurensi render sudah aktif (`RENDER_CONCURRENCY`, default `1`, di-clamp 1–2).
  Job render berat berjalan di antrean terpisah sehingga tidak memblokir job analisis/prepare.
- Fase 5 belum: cleanup otomatis `storage/tmp` + `storage/raw-clips` > 24 jam, dan upload
  MP4 lokal sebagai fallback bila YouTube memblokir IP server.
- Jalankan **satu** consumer per mesin; batas 1–2 job render berlaku per proses consumer.
  Menjalankan dua consumer berarti batas total menjadi dua kali lipat.
