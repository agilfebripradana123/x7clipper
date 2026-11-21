# PRD — Web Clipper (YouTube AI Moment Finder & Web Editor)

- **Versi:** 1.0 (MVP)
- **Status:** Draft Siap Eksekusi
- **Target Rilis:** MVP Lokal -> Staging VPS

---

## 1. Ringkasan Produk
Web Clipper adalah aplikasi berbasis web untuk mengubah video YouTube berdurasi panjang (podcast, wawancara, edukasi, commentary) menjadi klip pendek siap tayang (TikTok, Instagram Reels, YouTube Shorts).

Sistem mengekstrak transkrip bertimestamp, mengirimkannya ke LLM melalui **9router** untuk menyeleksi momen dengan *hook* dan konteks paling utuh, memotong segmen video secara parsial, lalu menyediakan **Web Video Editor** agar pengguna dapat menyempurnakan *trim*, rasio aspek (`9:16`), dan *subtitle* sebelum melakukan *final render*.

---

## 2. Masalah & Solusi
- **Masalah:** Mengedit video panjang 30–120 menit secara manual untuk mencari potongan 30–60 detik yang menarik memakan waktu lama, dan mengunduh video penuh beresolusi tinggi memboroskan penyimpanan serta bandwidth.
- **Solusi:** Automasi seleksi momen berbasis transkrip menggunakan AI (9router) dengan pendekatan **Segment-ID Anchoring** agar potongan akurat, dikombinasikan dengan *partial segment download* (`yt-dlp`) dan web editor ringan untuk finalisasi cepat.

---

## 3. Ruang Lingkup (Scope)

### In-Scope (MVP v1.0)
1. Input URL YouTube publik (dan opsi cadangan upload MP4 lokal di fase akhir).
2. Ekstraksi metadata video dan transkrip bertimestamp (Bahasa Indonesia & Inggris).
3. Analisis AI via **9router** dengan strategi *chunking* untuk video berdurasi panjang.
4. Daftar rekomendasi klip lengkap dengan judul saran, skor viral (`1-100`), tipe *hook*, alasan AI, dan rentang waktu.
5. Pemotongan video parsial *on-demand* (hanya segmen yang dipilih/dibuka) lengkap dengan sinkronisasi subtitle mulai dari `00:00`.
6. Web Video Editor: geser batas *trim* awal/akhir, pilih rasio `16:9` atau `9:16` dengan pengaturan posisi *crop* horizontal, serta edit teks & gaya *subtitle*.
7. Proses *final render* asinkron via antrean (Redis) dengan indikator progres dan tautan unduh `.mp4`.

### Out-of-Scope (Fase v2 / Lanjutan)
- Auto face-tracking / active speaker detection (OpenCV/MediaPipe).
- Multi-track timeline editor (B-roll, transisi kompleks, audio mixing multi-layer).
- Auto-publish langsung ke API TikTok/Instagram/YouTube.
- Sistem pembayaran, paket langganan, dan manajemen kuota user.

---

## 4. Alur Pengguna (User Flow)

1. **Input Video:** User menempelkan URL YouTube lalu menekan tombol *Analisis*.
2. **Monitoring Proses:** UI menampilkan progres *real-time* (`Queued -> Mengambil Transkrip -> Analisis AI -> Selesai`).
3. **Review Momen:** User melihat daftar 3–10 klip rekomendasi AI beserta skor viral, ringkasan alasan, dan cuplikan transkripnya.
4. **Siapkan & Edit Klip:** User memilih satu klip -> sistem memotong segmen mentahnya -> klip terbuka di **Web Video Editor**.
5. **Kustomisasi:** User menggeser titik trim, memilih rasio `9:16`, menggeser posisi frame wajah, memperbaiki typo subtitle, dan memilih preset teks.
6. **Export:** User klik *Render Final* -> memantau progress bar -> mengunduh file `.mp4` hasil akhir.

---

## 5. Spesifikasi Fungsional (Functional Requirements)

### FR-1: Input & Validasi Video
- Sistem menerima URL YouTube standar (`youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/live/...`).
- Sistem mengambil metadata (`title`, `duration_sec`, `thumbnail_url`, ketersediaan subtitle) menggunakan `yt-dlp`.
- Menolak video berdurasi di bawah 1 menit atau URL tidak valid dengan pesan error yang jelas.

### FR-2: Ekstraksi Transkrip & AI Moment Selector (9router)
- Transkrip diambil dari subtitle/auto-caption YouTube dan dipadatkan menjadi segmen kalimat berdurasi 6–10 detik ber-ID (`[S1|0]`, `[S2|7]`, dst.).
- Video berdurasi kurang dari 20 menit dianalisis dalam 1 request; video 20 menit atau lebih dipecah per 15 menit dengan *overlap* 2 menit.
- AI melalui 9router wajib mengembalikan output JSON terstruktur merujuk `start_segment_id` dan `end_segment_id` (bukan menebak detik mentah).
- Sistem melakukan validasi ID segmen, rentang durasi (15–110 detik), padding pengaman (`-0.35s` awal, `+0.50s` akhir), serta deduplikasi klip yang bertumpuk lebih dari 50%.

### FR-3: Smart Clipping & Sinkronisasi Subtitle
- Klip mentah hanya diunduh saat user memilih klip (atau diproses terbatas per proyek) menggunakan `yt-dlp --download-sections` agar tidak mengunduh video penuh.
- FFmpeg merapikan *keyframe* awal potongan agar video tidak membeku (*freeze*) saat diputar di browser.
- Timestamp subtitle dipotong sesuai rentang klip dan digeser mundur sebesar `start_sec` sehingga selalu dimulai di `00:00`.

### FR-4: Web Video Editor (Studio Layout & AI Auto-Editor)
- **Canvas Preview 9:16 & Auto-Skip:** Pratinjau vertikal langsung menerapkan hook banner, layout (crop/blur), dan viral subtitle. Saat video diputar, playhead otomatis melompati (auto-skip) bagian dead air yang dipotong.
- **Drag-to-Pan Crop:** User dapat menggeser/drag area preview langsung ke kiri/kanan untuk mengatur `crop_x` (0.0 - 1.0).
- **Panel Bertab (Gaya & Hook, Subtitle, Export):**
  - **Preset 1-Klik:** 3 preset instan (`Hormozi Bold`, `Podcast Clean`, `Breaking Hook`) untuk kombinasi gaya banner, subtitle, dan layout.
  - **Subtitle Interaktif:** Sinkronisasi playhead; klik baris teks langsung memposisikan video ke detik tersebut.
  - **Multi-Cut Timeline:** Split segmen di playhead (shortcut `S`), hapus/pulihkan blok, undo (`Ctrl+Z`), dan spacebar Play/Pause.
- **Auto-Save:** Konfigurasi editor otomatis tersimpan di latar belakang tanpa tombol simpan manual yang membingungkan.

### FR-5: Final Rendering & Export
- Perubahan editor disimpan sebagai konfigurasi JSON (`edit_config_json`).
- Saat user menekan *Export*, backend memasukkan job ke Redis Queue.
- Worker menjalankan FFmpeg untuk memproses `trim/multi-cut concat -> crop/blur -> burn-in ASS subtitle + audio broadcast loudnorm (-14 LUFS)` menggunakan font open-source Montserrat tebal.
- User dapat melihat persentase progres render dan mengunduh file `.mp4` final.
- **Riwayat Proyek & URL State Persistence:**
  - Riwayat 20 proyek terbaru ditampilkan di halaman utama (judul, status badge, jumlah klip, tombol buka & hapus).
  - URL routing (`/projects/:projectId`, `/projects/:projectId/clips/:clipId`) menjaga state saat refresh halaman (F5) dan auto-resume proses polling (analisis, prepare klip, dan render).

---

## 6. Spesifikasi Non-Fungsional (Non-Functional Requirements)

- **Asinkron:** Tidak ada proses `yt-dlp`, pemanggilan LLM 9router, atau `FFmpeg` yang berjalan sinkron di HTTP request utama.
- **Konsistensi Visual:** Seluruh parameter posisi crop dan teks disimpan dalam persentase (`0.0 - 1.0`) agar posisi hasil render FFmpeg presisi dengan tampilan browser.
- **Manajemen Resource:** Worker membatasi konkurensi render maksimal 1–2 job secara bersamaan per node untuk mencegah CPU 100%.
- **Retensi Penyimpanan:** File sementara (`tmp/`, `raw-clips/`) dijadwalkan terhapus otomatis setelah 24 jam.
- **Resiliensi AI:** Jika JSON dari model utama 9router rusak atau terkena rate-limit, sistem melakukan pembersihan format (strip markdown fence) dan *retry* ke model *fallback*.

---

## 7. Model Data Inti

### Tabel `projects`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | UUID / BigInt | Primary Key |
| `youtube_url` | String | URL sumber video |
| `video_title` | String | Judul video dari metadata |
| `duration_sec` | Integer | Total durasi video dalam detik |
| `transcript_segments_json` | LongText/JSON | Peta `segmentMap` (`S1 -> {start, end, text}`) |
| `status` | Enum | `queued`, `extracting`, `analyzing`, `ready`, `failed` |
| `error_message` | Text (Nullable) | Detail error jika gagal |

### Tabel `clips`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | UUID / BigInt | Primary Key |
| `project_id` | FK | Relasi ke `projects` |
| `title` | String | Judul hook dari AI |
| `start_sec` | Float | Detik mulai (sudah dipadding) |
| `end_sec` | Float | Detik akhir (sudah dipadding) |
| `viral_score` | Integer | Skor 1–100 dari AI |
| `hook_type` | String | `contrarian`, `story`, `actionable_tip`, `emotional`, `debate` |
| `ai_reason` | Text | Penjelasan singkat alasan pemilihan momen |
| `suggested_caption` | Text | Saran caption media sosial |
| `raw_clip_path` | String (Nullable) | Path file `.mp4` mentah hasil smart clipping |
| `subtitle_json` | JSON (Nullable) | Array segmen subtitle yang sudah digeser ke `00:00` |
| `edit_config_json` | JSON (Nullable) | Konfigurasi trim, `aspect_ratio`, `crop_x` (`0.0-1.0`), style subtitle |

### Tabel `render_jobs`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | UUID / BigInt | Primary Key |
| `clip_id` | FK | Relasi ke `clips` |
| `status` | Enum | `queued`, `rendering`, `done`, `failed` |
| `progress_percent` | Integer | Nilai `0` sampai `100` |
| `output_url` | String (Nullable) | Path/URL file `.mp4` hasil akhir |
| `error_message` | Text (Nullable) | Log error FFmpeg jika gagal |

---

## 8. Kriteria Keberhasilan MVP
1. Video podcast 60 menit selesai dianalisis transkripnya oleh 9router dalam waktu di bawah 90 detik tanpa error *timestamp* meleset.
2. Pemotongan klip 60 detik berhasil dilakukan tanpa mengunduh video penuh dan video dapat diputar mulus sejak detik `00:00` (tidak freeze).
3. Hasil render final `9:16` dengan subtitle *burn-in* sesuai dengan pratinjau di Web Video Editor.