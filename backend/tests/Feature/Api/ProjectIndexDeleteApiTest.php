<?php

namespace Tests\Feature\Api;

use App\Models\Clip;
use App\Models\Project;
use App\Models\RenderJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProjectIndexDeleteApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_index_returns_latest_20_projects_with_clips_count(): void
    {
        for ($i = 1; $i <= 25; $i++) {
            $p = Project::create([
                'youtube_url' => "https://youtu.be/video{$i}",
                'video_title' => "Video {$i}",
                'duration_sec' => 300,
                'status' => 'ready',
            ]);

            if ($i === 25) {
                Clip::create([
                    'project_id' => $p->id,
                    'title' => 'Clip 1',
                    'start_sec' => 10,
                    'end_sec' => 30,
                    'viral_score' => 90,
                    'hook_type' => 'story',
                ]);
            }
        }

        $res = $this->getJson('/api/projects');
        $res->assertStatus(200);
        $res->assertJsonCount(20, 'data');

        // Proyek terbaru di awal
        $this->assertEquals("Video 25", $res->json('data.0.video_title'));
        $this->assertEquals(1, $res->json('data.0.clips_count'));
    }

    public function test_destroy_deletes_project_and_cascades_clips(): void
    {
        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dummy',
            'video_title' => 'Dummy Video',
            'duration_sec' => 120,
            'status' => 'ready',
        ]);

        $clip = Clip::create([
            'project_id' => $project->id,
            'title' => 'Sample Clip',
            'start_sec' => 5,
            'end_sec' => 25,
            'viral_score' => 85,
            'hook_type' => 'contrarian',
        ]);

        $job = RenderJob::create([
            'clip_id' => $clip->id,
            'status' => 'queued',
            'progress_percent' => 0,
        ]);

        $res = $this->deleteJson("/api/projects/{$project->id}");
        $res->assertStatus(200);
        $res->assertJson(['message' => 'Proyek berhasil dihapus.']);

        $this->assertDatabaseMissing('projects', ['id' => $project->id]);
        $this->assertDatabaseMissing('clips', ['id' => $clip->id]);
        $this->assertDatabaseMissing('render_jobs', ['id' => $job->id]);
    }
}
