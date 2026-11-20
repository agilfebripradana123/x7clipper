# Spec Desain: Backend Database Schema & Models (Fase 3 - Item 1)

- **Tanggal:** 2026-11-20
- **Status:** Approved by User
- **Lingkup:** Bootstrap Laravel 12 di `backend/`, konfigurasi koneksi MySQL `x7clip`, buat migrasi dan model Eloquent untuk `projects`, `clips`, dan `render_jobs` sesuai `PRD.md`.

---

## 1. Tujuan & Arsitektur
Menyediakan fondasi data persistence untuk sistem Web Clipper berbasis Laravel 12 dan MySQL dengan relasi berjenjang:
```text
projects (1) ──< clips (N) ──< render_jobs (N)
```

## 2. Struktur Tabel & Migrasi

### 2.1. Tabel `projects`
Menyimpan data video YouTube, metadata awal, dan transkrip bertimestamp utuh.
- `id`: `id()` (bigint unsigned auto-increment / primary key)
- `youtube_url`: `string(512)`
- `video_title`: `string(255)->nullable()`
- `duration_sec`: `unsignedInteger()->nullable()`
- `transcript_segments_json`: `longText()->nullable()`
- `status`: `string(32)->default('queued')` (index). Status yang didukung: `queued`, `extracting`, `analyzing`, `ready`, `failed`.
- `error_message`: `text()->nullable()`
- `timestamps()`

### 2.2. Tabel `clips`
Menyimpan rekomendasi klip hasil analisis 9router beserta hasil smart clipping dan konfigurasi editor.
- `id`: `id()` (bigint unsigned auto-increment / primary key)
- `project_id`: `foreignId('project_id')->constrained('projects')->cascadeOnDelete()`
- `title`: `string(255)`
- `start_sec`: `decimal('start_sec', 8, 3)`
- `end_sec`: `decimal('end_sec', 8, 3)`
- `viral_score`: `unsignedTinyInteger()`
- `hook_type`: `string(64)` (`contrarian`, `story`, `actionable_tip`, `emotional`, `debate`)
- `ai_reason`: `text()->nullable()`
- `suggested_caption`: `text()->nullable()`
- `raw_clip_path`: `string(512)->nullable()`
- `subtitle_json`: `longText()->nullable()`
- `edit_config_json`: `longText()->nullable()`
- `timestamps()`
- Indexes: `project_id`, `viral_score`

### 2.3. Tabel `render_jobs`
Menyimpan antrean proses export video vertikal FFmpeg.
- `id`: `id()` (bigint unsigned auto-increment / primary key)
- `clip_id`: `foreignId('clip_id')->constrained('clips')->cascadeOnDelete()`
- `status`: `string(32)->default('queued')` (index). Status: `queued`, `rendering`, `done`, `failed`.
- `progress_percent`: `unsignedTinyInteger()->default(0)`
- `output_url`: `string(512)->nullable()`
- `error_message`: `text()->nullable()`
- `timestamps()`
- Index: `status`

---

## 3. Model Eloquent & Casts

### 3.1. `App\Models\Project`
- `$fillable`: `youtube_url`, `video_title`, `duration_sec`, `transcript_segments_json`, `status`, `error_message`
- `$casts`: `transcript_segments_json` => `array`, `duration_sec` => `integer`
- Relasi: `hasMany(Clip::class)`

### 3.2. `App\Models\Clip`
- `$fillable`: `project_id`, `title`, `start_sec`, `end_sec`, `viral_score`, `hook_type`, `ai_reason`, `suggested_caption`, `raw_clip_path`, `subtitle_json`, `edit_config_json`
- `$casts`: `start_sec` => `float`, `end_sec` => `float`, `viral_score` => `integer`, `subtitle_json` => `array`, `edit_config_json` => `array`
- Relasi: `belongsTo(Project::class)`, `hasMany(RenderJob::class)`

### 3.3. `App\Models\RenderJob`
- `$fillable`: `clip_id`, `status`, `progress_percent`, `output_url`, `error_message`
- `$casts`: `progress_percent` => `integer`
- Relasi: `belongsTo(Clip::class)`

---

## 4. Rencana Pengujian
1. Verifikasi koneksi MySQL lokal ke database `x7clip`.
2. Jalankan migrasi `php artisan migrate:fresh --seed` tanpa error.
3. Unit test Eloquent:
   - Buat `Project` dengan payload transkrip JSON -> pastikan tersimpan dan di-cast menjadi `array`.
   - Buat `Clip` dengan `start_sec` float dan `edit_config_json` -> pastikan relasi `Project->clips` bekerja.
   - Buat `RenderJob` -> pastikan relasi `Clip->renderJobs` dan cascade delete berjalan saat Project/Clip dihapus.
