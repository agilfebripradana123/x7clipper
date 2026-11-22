<?php

namespace Tests\Feature\Api;

use App\Models\Clip;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClipConfigApiTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_returns_404_for_unknown_clip(): void
    {
        $this->patchJson('/api/clips/999999/config', [])->assertNotFound();
    }

    public function test_saves_edit_config_and_replaces_subtitles(): void
    {
        $clip = $this->makeClip([
            'edit_config_json' => ['crop_x' => 0.25],
            'subtitle_json' => [['start' => 0, 'end' => 1, 'text' => 'lama']],
        ]);

        $response = $this->patchJson("/api/clips/{$clip->id}/config", [
            'edit_config' => [
                'trim_start' => 2.5,
                'trim_end' => 18.0,
                'aspect_ratio' => '9:16',
                'crop_x' => 0.7,
                'subtitle' => [
                    'enabled' => true,
                    'position' => 'bottom',
                    'font_size' => 42,
                    'color' => '#FFE066',
                ],
            ],
            'subtitles' => [
                ['start' => 2.5, 'end' => 5.0, 'text' => 'baru satu'],
                ['start' => 5.0, 'end' => 8.25, 'text' => 'baru dua'],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.id', $clip->id)
            ->assertJsonPath('data.edit_config_json.aspect_ratio', '9:16')
            ->assertJsonPath('data.edit_config_json.crop_x', 0.7)
            ->assertJsonPath('data.edit_config_json.subtitle.font_size', 42)
            ->assertJsonCount(2, 'data.subtitle_json')
            ->assertJsonPath('data.subtitle_json.1.text', 'baru dua');

        $clip->refresh();

        // Partial PATCH: kunci lama yang tidak dikirim tetap dipertahankan.
        $this->assertSame(0.7, $clip->edit_config_json['crop_x']);
        $this->assertSame('9:16', $clip->edit_config_json['aspect_ratio']);
        $this->assertCount(2, $clip->subtitle_json);
    }

    public function test_partial_patch_keeps_existing_subtitles(): void
    {
        $clip = $this->makeClip([
            'subtitle_json' => [['start' => 0, 'end' => 2, 'text' => 'tetap']],
        ]);

        $this->patchJson("/api/clips/{$clip->id}/config", [
            'edit_config' => ['aspect_ratio' => '16:9'],
        ])->assertOk()
            ->assertJsonPath('data.subtitle_json.0.text', 'tetap');
    }

    public function test_rejects_invalid_aspect_ratio_and_crop(): void
    {
        $clip = $this->makeClip();

        $this->patchJson("/api/clips/{$clip->id}/config", [
            'edit_config' => ['aspect_ratio' => '21:9', 'crop_x' => 1.4],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['edit_config.aspect_ratio', 'edit_config.crop_x']);
    }

    public function test_accepts_all_valid_aspect_ratios_and_subtitle_font_size(): void
    {
        $clip = $this->makeClip();

        foreach (['9:16', '1:1', '4:3', '16:9'] as $ratio) {
            $this->patchJson("/api/clips/{$clip->id}/config", [
                'edit_config' => [
                    'aspect_ratio' => $ratio,
                    'subtitle_font_size' => 64,
                ],
            ])->assertOk()
                ->assertJsonPath('data.edit_config_json.aspect_ratio', $ratio)
                ->assertJsonPath('data.edit_config_json.subtitle_font_size', 64);
        }
    }

    public function test_rejects_trim_outside_clip_duration(): void
    {
        $clip = $this->makeClip();

        $this->patchJson("/api/clips/{$clip->id}/config", [
            'edit_config' => ['trim_start' => 10, 'trim_end' => 45],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['edit_config.trim_end']);
    }

    public function test_rejects_reversed_subtitle_range(): void
    {
        $clip = $this->makeClip();

        $this->patchJson("/api/clips/{$clip->id}/config", [
            'subtitles' => [['start' => 5, 'end' => 3, 'text' => 'salah']],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['subtitles.0.end']);
    }

    public function test_project_show_exposes_editor_state(): void
    {
        $clip = $this->makeClip([
            'edit_config_json' => ['aspect_ratio' => '9:16', 'crop_x' => 0.5],
        ]);

        $this->getJson("/api/projects/{$clip->project_id}")
            ->assertOk()
            ->assertJsonPath('data.clips.0.edit_config_json.aspect_ratio', '9:16')
            ->assertJsonPath('data.clips.0.subtitle_json', null);
    }
}
