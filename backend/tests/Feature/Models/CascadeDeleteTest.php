<?php

namespace Tests\Feature\Models;

use App\Models\Project;
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

        $project->delete();

        $this->assertDatabaseMissing('projects', ['id' => $project->id]);
        $this->assertDatabaseMissing('clips', ['id' => $clip->id]);
        $this->assertDatabaseMissing('render_jobs', ['id' => $job->id]);
    }
}
