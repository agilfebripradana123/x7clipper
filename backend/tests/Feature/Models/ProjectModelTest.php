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
