<?php

namespace Tests\Feature\Api;

use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProjectShowApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_returns_404_for_unknown_project(): void
    {
        $this->getJson('/api/projects/999999')->assertNotFound();
    }

    public function test_returns_project_with_clips_ordered_by_viral_score(): void
    {
        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
            'video_title' => 'Podcast Uji',
            'duration_sec' => 3600,
            'status' => 'ready',
        ]);

        $project->clips()->create([
            'title' => 'Klip Skor Rendah',
            'start_sec' => 10.5,
            'end_sec' => 50.25,
            'viral_score' => 61,
            'hook_type' => 'story',
            'ai_reason' => 'Biasa saja',
            'suggested_caption' => 'Caption A',
        ]);

        $project->clips()->create([
            'title' => 'Klip Skor Tinggi',
            'start_sec' => 120.125,
            'end_sec' => 175.875,
            'viral_score' => 94,
            'hook_type' => 'contrarian',
            'ai_reason' => 'Hook kuat',
            'suggested_caption' => 'Caption B',
        ]);

        $response = $this->getJson("/api/projects/{$project->id}");

        $response->assertOk()
            ->assertJsonPath('data.id', $project->id)
            ->assertJsonPath('data.status', 'ready')
            ->assertJsonPath('data.video_title', 'Podcast Uji')
            ->assertJsonPath('data.duration_sec', 3600)
            ->assertJsonPath('data.clips.0.title', 'Klip Skor Tinggi')
            ->assertJsonPath('data.clips.0.prepare_status', 'idle')
            ->assertJsonPath('data.clips.1.title', 'Klip Skor Rendah');

        $this->assertEqualsWithDelta(120.125, $response->json('data.clips.0.start_sec'), 0.001);
        $this->assertEqualsWithDelta(175.875, $response->json('data.clips.0.end_sec'), 0.001);
        $this->assertCount(2, $response->json('data.clips'));
    }
}
