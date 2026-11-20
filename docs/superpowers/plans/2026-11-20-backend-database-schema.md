# Backend Database Schema & Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap Laravel 12 di `backend/`, konfigurasi koneksi MySQL `x7clip`, dan buat migrasi serta model Eloquent untuk `projects`, `clips`, dan `render_jobs`.

**Architecture:** Laravel 12 API backend terhubung ke MySQL lokal. Migrasi membuat relasi cascade berjenjang `projects` -> `clips` -> `render_jobs` dengan tipe data presisi (decimal, casts JSON) dan indeks pipeline.

**Tech Stack:** PHP 8.3, Laravel 12, MySQL 8+, Composer, Pest/PHPUnit.

**Spec:** `docs/superpowers/specs/2026-11-20-backend-database-schema-design.md`

## Global Constraints

- PHP floor: 8.2+ (environment saat ini PHP 8.3.35).
- Database name: `x7clip` di `127.0.0.1:3306`, user `root`, password kosong.
- Semua field koordinat / detik float di `clips` menggunakan decimal presisi (`decimal('start_sec', 8, 3)` dan `decimal('end_sec', 8, 3)`).
- Field JSON (`transcript_segments_json`, `subtitle_json`, `edit_config_json`) menggunakan `longText` dengan auto-cast `array` di model Eloquent.
- Seluruh Foreign Key menggunakan `constrained()->cascadeOnDelete()`.

## Review Focus

1. Cascade delete: Menghapus project harus otomatis menghapus semua klip dan render_jobs miliknya.
2. JSON casting: Menyimpan string JSON atau PHP array harus otomatis ter-encode/decode tanpa korupsi payload transkrip panjang.
3. Decimal precision: `start_sec` dan `end_sec` bertipe 3 digit desimal (misal `256.730`) tidak boleh terpotong atau terbulatkan menjadi integer.
4. Default values: `status` project default `queued`, `progress_percent` render_job default `0`.
5. Missing attributes: Model fillable harus mengizinkan seluruh kolom PRD tanpa `MassAssignmentException`.

---

### Task 1: Bootstrap Laravel 12 Project & MySQL Config

**Files:**
- Create: `backend/` (Laravel application skeleton via Composer)
- Modify: `backend/.env`
- Test: `backend/tests/Feature/DatabaseConnectionTest.php`

**Interfaces:**
- Consumes: MySQL server di `127.0.0.1:3306`
- Produces: `backend/artisan`, file konfigurasi `.env`, vendor folder Laravel

- [ ] **Step 1: Bootstrap Laravel 12 skeleton di folder backend**

Run command dari root workspace:
```bash
composer create-project laravel/laravel:^12.0 backend --prefer-dist --no-interaction
```

- [ ] **Step 2: Konfigurasi .env koneksi database MySQL**

Update `backend/.env`:
```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=x7clip
DB_USERNAME=root
DB_PASSWORD=
```

- [ ] **Step 3: Buat database x7clip jika belum ada**

Run:
```bash
php -r "new PDO('mysql:host=127.0.0.1;port=3306', 'root', '')->exec('CREATE DATABASE IF NOT EXISTS \`x7clip\`');"
```

- [ ] **Step 4: Tulis test koneksi database**

Buat file `backend/tests/Feature/DatabaseConnectionTest.php`:
```php
<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DatabaseConnectionTest extends TestCase
{
    public function test_can_connect_to_mysql_database(): void
    {
        $databaseName = DB::connection()->getDatabaseName();
        $this->assertEquals('x7clip', $databaseName);

        $result = DB::select('SELECT 1 as connected');
        $this->assertEquals(1, $result[0]->connected);
    }
}
```

- [ ] **Step 5: Jalankan test koneksi database**

Run di folder `backend`:
```bash
php artisan test --filter=DatabaseConnectionTest
```
Expected: PASS (1 test, 2 assertions)

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(backend): bootstrap laravel 12 dan konfigurasi koneksi mysql"
```

---

### Task 2: Migrasi Database projects, clips, dan render_jobs

**Files:**
- Create: `backend/database/migrations/xxxx_xx_xx_000001_create_projects_table.php`
- Create: `backend/database/migrations/xxxx_xx_xx_000002_create_clips_table.php`
- Create: `backend/database/migrations/xxxx_xx_xx_000003_create_render_jobs_table.php`

**Interfaces:**
- Consumes: Skema tabel sesuai spec
- Produces: Struktur tabel MySQL `projects`, `clips`, `render_jobs`

- [ ] **Step 1: Buat migrasi tabel `projects`**

Isi file migrasi `backend/database/migrations/2026_11_20_000001_create_projects_table.php`:
```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->string('youtube_url', 512);
            $table->string('video_title', 255)->nullable();
            $table->unsignedInteger('duration_sec')->nullable();
            $table->longText('transcript_segments_json')->nullable();
            $table->string('status', 32)->default('queued')->index();
            $table->text('error_message')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
```

- [ ] **Step 2: Buat migrasi tabel `clips`**

Isi file migrasi `backend/database/migrations/2026_11_20_000002_create_clips_table.php`:
```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clips', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained('projects')->cascadeOnDelete();
            $table->string('title', 255);
            $table->decimal('start_sec', 8, 3);
            $table->decimal('end_sec', 8, 3);
            $table->unsignedTinyInteger('viral_score')->index();
            $table->string('hook_type', 64);
            $table->text('ai_reason')->nullable();
            $table->text('suggested_caption')->nullable();
            $table->string('raw_clip_path', 512)->nullable();
            $table->longText('subtitle_json')->nullable();
            $table->longText('edit_config_json')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clips');
    }
};
```

- [ ] **Step 3: Buat migrasi tabel `render_jobs`**

Isi file migrasi `backend/database/migrations/2026_11_20_000003_create_render_jobs_table.php`:
```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('render_jobs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clip_id')->constrained('clips')->cascadeOnDelete();
            $table->string('status', 32)->default('queued')->index();
            $table->unsignedTinyInteger('progress_percent')->default(0);
            $table->string('output_url', 512)->nullable();
            $table->text('error_message')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('render_jobs');
    }
};
```

- [ ] **Step 4: Jalankan migrasi dan pastikan sukses**

Run di `backend`:
```bash
php artisan migrate:fresh
```
Expected: All tables migrated successfully (`projects`, `clips`, `render_jobs`).

- [ ] **Step 5: Commit**

```bash
git add database/migrations/
git commit -m "feat(backend): buat migrasi tabel projects, clips, render_jobs"
```

---

### Task 3: Model Eloquent & Relasi Data

**Files:**
- Create: `backend/app/Models/Project.php`
- Create: `backend/app/Models/Clip.php`
- Create: `backend/app/Models/RenderJob.php`

**Interfaces:**
- Consumes: Tabel `projects`, `clips`, `render_jobs`
- Produces: Eloquent Models dengan relasi `Project->clips()`, `Clip->project()`, `Clip->renderJobs()`, `RenderJob->clip()`

- [ ] **Step 1: Buat model `Project`**

`backend/app/Models/Project.php`:
```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Project extends Model
{
    use HasFactory;

    protected $fillable = [
        'youtube_url',
        'video_title',
        'duration_sec',
        'transcript_segments_json',
        'status',
        'error_message',
    ];

    protected $casts = [
        'duration_sec' => 'integer',
        'transcript_segments_json' => 'array',
    ];

    public function clips(): HasMany
    {
        return $this->hasMany(Clip::class);
    }
}
```

- [ ] **Step 2: Buat model `Clip`**

`backend/app/Models/Clip.php`:
```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Clip extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id',
        'title',
        'start_sec',
        'end_sec',
        'viral_score',
        'hook_type',
        'ai_reason',
        'suggested_caption',
        'raw_clip_path',
        'subtitle_json',
        'edit_config_json',
    ];

    protected $casts = [
        'start_sec' => 'float',
        'end_sec' => 'float',
        'viral_score' => 'integer',
        'subtitle_json' => 'array',
        'edit_config_json' => 'array',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function renderJobs(): HasMany
    {
        return $this->hasMany(RenderJob::class);
    }
}
```

- [ ] **Step 3: Buat model `RenderJob`**

`backend/app/Models/RenderJob.php`:
```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RenderJob extends Model
{
    use HasFactory;

    protected $fillable = [
        'clip_id',
        'status',
        'progress_percent',
        'output_url',
        'error_message',
    ];

    protected $casts = [
        'progress_percent' => 'integer',
    ];

    public function clip(): BelongsTo
    {
        return $this->belongsTo(Clip::class);
    }
}
```

- [ ] **Step 4: Commit model Eloquent**

```bash
git add app/Models/
git commit -m "feat(backend): buat model Project, Clip, RenderJob dengan relasi dan casts"
```

---

### Task 4: Unit & Feature Test Model, Relasi, dan Integrity Constraint

**Files:**
- Create: `backend/tests/Feature/Models/ProjectModelTest.php`
- Create: `backend/tests/Feature/Models/ClipModelTest.php`
- Create: `backend/tests/Feature/Models/CascadeDeleteTest.php`

**Interfaces:**
- Consumes: Models `Project`, `Clip`, `RenderJob`
- Produces: Verifikasi persistensi, tipe data float desimal, array casts, dan cascade delete

- [ ] **Step 1: Tulis feature test untuk `Project` model & JSON cast**

`backend/tests/Feature/Models/ProjectModelTest.php`:
```php
<?php

namespace Tests\Feature\Models;

use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProjectModelTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_create_project_with_json_cast(): void
    {
        $segments = [
            'S1' => ['start' => 0.0, 'end' => 7.5, 'text' => 'Halo semua'],
            'S2' => ['start' => 7.5, 'end' => 15.2, 'text' => 'Selamat datang di podcast'],
        ];

        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
            'video_title' => 'Video Uji Coba',
            'duration_sec' => 3200,
            'transcript_segments_json' => $segments,
            'status' => 'queued',
        ]);

        $this->assertDatabaseHas('projects', [
            'id' => $project->id,
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
            'status' => 'queued',
        ]);

        $fresh = $project->fresh();
        $this->assertIsArray($fresh->transcript_segments_json);
        $this->assertEquals('Halo semua', $fresh->transcript_segments_json['S1']['text']);
        $this->assertEquals(3200, $fresh->duration_sec);
    }
}
```

- [ ] **Step 2: Tulis feature test untuk `Clip` model desimal & relasi**

`backend/tests/Feature/Models/ClipModelTest.php`:
```php
<?php

namespace Tests\Feature\Models;

use App\Models\Clip;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClipModelTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_create_clip_with_float_precision_and_relation(): void
    {
        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
            'video_title' => 'Video Uji Coba',
        ]);

        $clip = $project->clips()->create([
            'title' => 'Hook Menarik',
            'start_sec' => 256.735,
            'end_sec' => 294.382,
            'viral_score' => 92,
            'hook_type' => 'story',
            'ai_reason' => 'Cerita kuat',
            'suggested_caption' => 'Wajib ditonton!',
            'subtitle_json' => [
                ['start' => 0.0, 'end' => 2.5, 'text' => 'Dendam dia'],
            ],
            'edit_config_json' => [
                'aspect_ratio' => '9:16',
                'crop_x' => 0.5,
            ],
        ]);

        $this->assertEquals($project->id, $clip->project_id);
        $this->assertEquals(256.735, $clip->start_sec);
        $this->assertEquals(294.382, $clip->end_sec);
        $this->assertIsArray($clip->subtitle_json);
        $this->assertEquals('9:16', $clip->edit_config_json['aspect_ratio']);
        $this->assertCount(1, $project->fresh()->clips);
    }
}
```

- [ ] **Step 3: Tulis feature test untuk `CascadeDelete`**

`backend/tests/Feature/Models/CascadeDeleteTest.php`:
```php
<?php

namespace Tests\Feature\Models;

use App\Models\Clip;
use App\Models\Project;
use App\Models\RenderJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CascadeDeleteTest extends TestCase
{
    use RefreshDatabase;

    public function test_deleting_project_cascades_to_clips_and_render_jobs(): void
    {
        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
        ]);

        $clip = $project->clips()->create([
            'title' => 'Klip Uji',
            'start_sec' => 10.0,
            'end_sec' => 45.0,
            'viral_score' => 85,
            'hook_type' => 'actionable_tip',
        ]);

        $job = $clip->renderJobs()->create([
            'status' => 'queued',
            'progress_percent' => 0,
        ]);

        $this->assertDatabaseHas('projects', ['id' => $project->id]);
        $this->assertDatabaseHas('clips', ['id' => $clip->id]);
        $this->assertDatabaseHas('render_jobs', ['id' => $job->id]);

        // Hapus project
        $project->delete();

        // Pastikan cascade terhapus di database
        $this->assertDatabaseMissing('projects', ['id' => $project->id]);
        $this->assertDatabaseMissing('clips', ['id' => $clip->id]);
        $this->assertDatabaseMissing('render_jobs', ['id' => $job->id]);
    }
}
```

- [ ] **Step 4: Jalankan seluruh test suite**

Run di `backend`:
```bash
php artisan test
```
Expected: PASS all tests.

- [ ] **Step 5: Update dokumentasi progress & AGENTS.md**

Ubah checklist Fase 3 item 1 di `AGENTS.md` menjadi `[x]`, tambahkan log implementasi di `docs/progress.md`.

- [ ] **Step 6: Commit dan Push**

```bash
git add .
git commit -m "feat(backend): tuntas migrasi dan model database projects, clips, render_jobs (fase 3 item 1)"
git push origin main
```
