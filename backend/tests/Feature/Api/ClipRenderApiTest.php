<?php

namespace Tests\Feature\Api;

use App\Models\Clip;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class ClipRenderApiTest extends TestCase
{
    use RefreshDatabase;

    private ?string $rawPath = null;

    protected function setUp(): void
    {
        parent::setUp();

        Redis::connection()->del('x7:jobs');
    }

    protected function tearDown(): void
    {
        if ($this->rawPath !== null) {
            @unlink($this->rawPath);
        }

        Facade::clearResolvedInstances();
        Redis::connection()->del('x7:jobs');

        parent::tearDown();
    }

    private function makeClip(array $attributes = []): Clip
    {
        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
            'video_title' => 'Video Uji Coba',
        ]);

        return $project->clips()->create(array_merge([
            'title' => 'Hook Menarik',
            'start_sec' => 10.0,
            'end_sec' => 40.0,
            'viral_score' => 90,
            'hook_type' => 'story',
        ], $attributes));
    }

    private function makeReadyClip(): Clip
    {
        $this->rawPath = tempnam(sys_get_temp_dir(), 'clip_');
        file_put_contents($this->rawPath, 'fake-video-bytes');

        return $this->makeClip([
            'prepare_status' => 'ready',
            'raw_clip_path' => $this->rawPath,
        ]);
    }

    public function test_unprepared_clip_returns_409_without_queueing(): void
    {
        $clip = $this->makeClip();

        $this->postJson("/api/clips/{$clip->id}/render")
            ->assertStatus(409)
            ->assertJsonPath('message', 'Klip belum siap dirender.');

        $this->assertSame([], Redis::connection()->lrange('x7:jobs', 0, -1));
        $this->assertDatabaseCount('render_jobs', 0);
    }

    public function test_ready_clip_creates_job_and_pushes_render_job_message(): void
    {
        $clip = $this->makeReadyClip();

        $response = $this->postJson("/api/clips/{$clip->id}/render");

        $response->assertStatus(202)
            ->assertJsonPath('data.clip_id', $clip->id)
            ->assertJsonPath('data.status', 'queued')
            ->assertJsonPath('data.progress_percent', 0);

        $this->assertDatabaseHas('render_jobs', [
            'id' => $response->json('data.id'),
            'clip_id' => $clip->id,
            'status' => 'queued',
        ]);

        $jobs = Redis::connection()->lrange('x7:jobs', 0, -1);
        $this->assertCount(1, $jobs);

        $job = json_decode($jobs[0], true);
        $this->assertSame('render_clip', $job['type']);
        $this->assertSame($response->json('data.id'), $job['render_job_id']);
        $this->assertSame($clip->id, $job['clip_id']);
    }

    public function test_active_job_is_reused_without_push(): void
    {
        $clip = $this->makeReadyClip();
        $existing = $clip->renderJobs()->create(['status' => 'rendering', 'progress_percent' => 42]);

        $response = $this->postJson("/api/clips/{$clip->id}/render");

        $response->assertStatus(202)
            ->assertJsonPath('data.id', $existing->id)
            ->assertJsonPath('data.status', 'rendering')
            ->assertJsonPath('data.progress_percent', 42);

        $this->assertDatabaseCount('render_jobs', 1);
        $this->assertSame([], Redis::connection()->lrange('x7:jobs', 0, -1));
    }

    public function test_enqueue_failure_returns_503_and_marks_job_failed(): void
    {
        $clip = $this->makeReadyClip();
        $realRedis = app('redis');

        Redis::shouldReceive('connection')->andReturnSelf();
        Redis::shouldReceive('lpush')->andThrow(new \RuntimeException('redis down'));

        try {
            $response = $this->postJson("/api/clips/{$clip->id}/render");
        } finally {
            Facade::clearResolvedInstances();
            app()->instance('redis', $realRedis);
        }

        $response->assertStatus(503)
            ->assertJsonPath('data.status', 'failed')
            ->assertJsonPath('data.error_message', 'Failed to enqueue render job: redis down');

        $this->assertDatabaseHas('render_jobs', [
            'id' => $response->json('data.id'),
            'status' => 'failed',
        ]);
    }

    public function test_show_returns_progress_and_output(): void
    {
        $clip = $this->makeClip();
        $renderJob = $clip->renderJobs()->create([
            'status' => 'done',
            'progress_percent' => 100,
            'output_url' => 'storage/exports/clip-1.mp4',
        ]);

        $this->getJson("/api/render-jobs/{$renderJob->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $renderJob->id)
            ->assertJsonPath('data.status', 'done')
            ->assertJsonPath('data.progress_percent', 100)
            ->assertJsonPath('data.output_url', 'storage/exports/clip-1.mp4')
            ->assertJsonPath('data.error_message', null);
    }

    public function test_show_returns_404_for_unknown_job(): void
    {
        $this->getJson('/api/render-jobs/999999')->assertNotFound();
    }
}
