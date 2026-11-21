<?php

namespace Tests\Feature\Api;

use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProjectUploadApiTest extends TestCase
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

    public function test_upload_requires_video_and_subtitle(): void
    {
        $response = $this->postJson('/api/projects/upload', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['video', 'subtitle']);
    }

    public function test_upload_success_creates_project_and_pushes_job(): void
    {
        $video = UploadedFile::fake()->create('sample_podcast.mp4', 1024, 'video/mp4');
        $subtitle = UploadedFile::fake()->create('sample_podcast.vtt', 10, 'text/vtt');

        $response = $this->postJson('/api/projects/upload', [
            'video' => $video,
            'subtitle' => $subtitle,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.source_type', 'upload')
            ->assertJsonPath('data.video_title', 'sample_podcast')
            ->assertJsonPath('data.status', 'queued');

        $projectId = $response->json('data.id');

        $this->assertDatabaseHas('projects', [
            'id' => $projectId,
            'source_type' => 'upload',
            'video_title' => 'sample_podcast',
            'status' => 'queued',
        ]);

        $jobs = Redis::connection()->lrange('x7:jobs', 0, -1);
        $this->assertCount(1, $jobs);

        $job = json_decode($jobs[0], true);
        $this->assertSame('analyze_project', $job['type']);
        $this->assertSame($projectId, $job['project_id']);
        $this->assertSame('upload', $job['source_type']);
        $this->assertStringContainsString("project-{$projectId}-video.mp4", $job['video_path']);
        $this->assertStringContainsString("project-{$projectId}-sub.vtt", $job['subtitle_path']);

        // Cleanup created files in storage/uploads
        $uploadDir = dirname(base_path()).DIRECTORY_SEPARATOR.'storage'.DIRECTORY_SEPARATOR.'uploads';
        @unlink($uploadDir.DIRECTORY_SEPARATOR."project-{$projectId}-video.mp4");
        @unlink($uploadDir.DIRECTORY_SEPARATOR."project-{$projectId}-sub.vtt");
    }
}
