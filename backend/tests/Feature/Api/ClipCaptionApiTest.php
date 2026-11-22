<?php

namespace Tests\Feature\Api;

use App\Models\Clip;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClipCaptionApiTest extends TestCase
{
    use RefreshDatabase;

    private function makeClip(): Clip
    {
        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
            'video_title' => 'Video Uji Coba',
        ]);

        return $project->clips()->create([
            'title' => 'Rahasia Sukses Bisnis',
            'start_sec' => 10.0,
            'end_sec' => 40.0,
            'viral_score' => 90,
            'hook_type' => 'story',
            'subtitle_json' => [
                ['start' => 0, 'end' => 2, 'text' => 'Halo semuanya'],
                ['start' => 2, 'end' => 4, 'text' => 'ini rahasia sukses'],
            ],
        ]);
    }

    public function test_generate_caption_creates_gen_z_caption_with_hashtags(): void
    {
        $clip = $this->makeClip();

        $response = $this->postJson("/api/clips/{$clip->id}/caption");

        $response->assertOk()
            ->assertJsonPath('data.id', $clip->id);

        $caption = $response->json('data.suggested_caption');
        $this->assertNotEmpty($caption);
        $this->assertStringContainsString('#', $caption);

        $clip->refresh();
        $this->assertSame($caption, $clip->suggested_caption);
    }

    public function test_update_config_accepts_suggested_caption_and_fonts(): void
    {
        $clip = $this->makeClip();

        $response = $this->patchJson("/api/clips/{$clip->id}/config", [
            'suggested_caption' => 'Ini caption manual baru #fyp #viral #bisnis',
            'edit_config' => [
                'hook_font' => 'anton',
                'subtitle_font' => 'jakarta',
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.suggested_caption', 'Ini caption manual baru #fyp #viral #bisnis')
            ->assertJsonPath('data.edit_config_json.hook_font', 'anton')
            ->assertJsonPath('data.edit_config_json.subtitle_font', 'jakarta');

        $clip->refresh();
        $this->assertSame('Ini caption manual baru #fyp #viral #bisnis', $clip->suggested_caption);
        $this->assertSame('anton', $clip->edit_config_json['hook_font']);
        $this->assertSame('jakarta', $clip->edit_config_json['subtitle_font']);
    }
}
