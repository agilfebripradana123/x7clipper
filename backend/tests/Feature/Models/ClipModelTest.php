<?php

namespace Tests\Feature\Models;

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
