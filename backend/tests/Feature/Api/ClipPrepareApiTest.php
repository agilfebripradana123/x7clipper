<?php

namespace Tests\Feature\Api;

use App\Models\Clip;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class ClipPrepareApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Redis::connection()->del('x7:jobs');
    }

    protected function tearDown(): void
    {
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

    public function test_ready_clip_with_existing_file_returns_200_without_queueing(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'clip_');
        file_put_contents($path, 'fake-video-bytes');

        try {
            $clip = $this->makeClip([
                'prepare_status' => 'ready',
                'raw_clip_path' => $path,
            ]);

            $response = $this->postJson("/api/clips/{$clip->id}/prepare");

            $response->assertStatus(200)
                ->assertJsonPath('data.id', $clip->id)
                ->assertJsonPath('data.prepare_status', 'ready')
                ->assertJsonPath('data.raw_clip_path', $path);

            $this->assertSame([], Redis::connection()->lrange('x7:jobs', 0, -1));
            $this->assertDatabaseHas('clips', [
                'id' => $clip->id,
                'prepare_status' => 'ready',
            ]);
        } finally {
            @unlink($path);
        }
    }

    public function test_preparing_clip_returns_202_without_queueing(): void
    {
        $clip = $this->makeClip(['prepare_status' => 'preparing']);

        $response = $this->postJson("/api/clips/{$clip->id}/prepare");

        $response->assertStatus(202)
            ->assertJsonPath('data.prepare_status', 'preparing');

        $this->assertSame([], Redis::connection()->lrange('x7:jobs', 0, -1));
    }

    public function test_idle_clip_returns_202_updates_status_and_pushes_job(): void
    {
        $clip = $this->makeClip();

        $response = $this->postJson("/api/clips/{$clip->id}/prepare");

        $response->assertStatus(202)
            ->assertJsonPath('data.prepare_status', 'preparing');

        $this->assertDatabaseHas('clips', [
            'id' => $clip->id,
            'prepare_status' => 'preparing',
            'prepare_error' => null,
        ]);

        $jobs = Redis::connection()->lrange('x7:jobs', 0, -1);
        $this->assertCount(1, $jobs);

        $job = json_decode($jobs[0], true);
        $this->assertSame('prepare_clip', $job['type']);
        $this->assertSame($clip->id, $job['clip_id']);
    }

    public function test_enqueue_failure_returns_503_and_marks_clip_failed(): void
    {
        $clip = $this->makeClip();
        $realRedis = app('redis');

        Redis::shouldReceive('connection')->andReturnSelf();
        Redis::shouldReceive('lpush')->andThrow(new \RuntimeException('redis down'));

        try {
            $response = $this->postJson("/api/clips/{$clip->id}/prepare");
        } finally {
            Facade::clearResolvedInstances();
            app()->instance('redis', $realRedis);
        }

        $response->assertStatus(503)
            ->assertJsonPath('data.prepare_status', 'failed')
            ->assertJsonPath('data.prepare_error', 'Failed to enqueue prepare job: redis down');

        $this->assertDatabaseHas('clips', [
            'id' => $clip->id,
            'prepare_status' => 'failed',
            'prepare_error' => 'Failed to enqueue prepare job: redis down',
        ]);
    }

    public function test_force_prepare_requeues_job_even_when_file_exists(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'clip_');
        file_put_contents($path, 'fake-video-bytes');

        try {
            $clip = $this->makeClip([
                'prepare_status' => 'ready',
                'raw_clip_path' => $path,
            ]);

            $response = $this->postJson("/api/clips/{$clip->id}/prepare", ['force' => true]);

            $response->assertStatus(202)
                ->assertJsonPath('data.prepare_status', 'preparing');

            $jobs = Redis::connection()->lrange('x7:jobs', 0, -1);
            $this->assertCount(1, $jobs);

            $job = json_decode($jobs[0], true);
            $this->assertSame('prepare_clip', $job['type']);
            $this->assertSame($clip->id, $job['clip_id']);
            $this->assertTrue($job['force']);
        } finally {
            @unlink($path);
        }
    }
}
