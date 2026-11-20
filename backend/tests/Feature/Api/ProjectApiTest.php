<?php

namespace Tests\Feature\Api;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class ProjectApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Redis::connection()->del('x7:jobs');
    }

    protected function tearDown(): void
    {
        Redis::connection()->del('x7:jobs');

        parent::tearDown();
    }

    public function test_invalid_url_returns_422_and_pushes_no_job(): void
    {
        $response = $this->postJson('/api/projects', [
            'youtube_url' => 'https://vimeo.com/123456789',
        ]);

        $response->assertStatus(422);
        $this->assertDatabaseCount('projects', 0);
        $this->assertSame([], Redis::connection()->lrange('x7:jobs', 0, -1));
    }

    public function test_watch_url_creates_queued_project_and_pushes_job(): void
    {
        $response = $this->postJson('/api/projects', [
            'youtube_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'queued')
            ->assertJsonPath('data.youtube_url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

        $projectId = $response->json('data.id');
        $this->assertDatabaseHas('projects', [
            'id' => $projectId,
            'youtube_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'status' => 'queued',
        ]);

        $jobs = Redis::connection()->lrange('x7:jobs', 0, -1);
        $this->assertCount(1, $jobs);

        $job = json_decode($jobs[0], true);
        $this->assertSame('analyze_project', $job['type']);
        $this->assertSame($projectId, $job['project_id']);
        $this->assertSame(1, $job['attempt']);
    }

    public function test_short_youtu_be_and_live_urls_are_accepted(): void
    {
        $this->postJson('/api/projects', [
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
        ])->assertStatus(201);

        $this->postJson('/api/projects', [
            'youtube_url' => 'https://www.youtube.com/live/dQw4w9WgXcQ',
        ])->assertStatus(201);

        $this->assertDatabaseCount('projects', 2);
        $this->assertCount(2, Redis::connection()->lrange('x7:jobs', 0, -1));
    }
}
