<?php

namespace Tests\Feature\Api;

use App\Models\Clip;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
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

    public function test_generate_caption_calls_9router_with_transcript_and_saves_result(): void
    {
        config([
            'services.ninerouter.base_url' => 'https://api.9router.test/v1',
            'services.ninerouter.api_key' => 'fake-key',
            'services.ninerouter.model' => 'test-model',
        ]);

        Http::fake([
            'https://api.9router.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => "Gila sih relate parah! Komen di bawah menurut kalian gimana? #fyp #viral #sukses",
                        ],
                    ],
                ],
            ], 200),
        ]);

        $clip = $this->makeClip();

        $response = $this->postJson("/api/clips/{$clip->id}/caption");

        $response->assertOk()
            ->assertJsonPath('data.id', $clip->id)
            ->assertJsonPath('data.suggested_caption', 'Gila sih relate parah! Komen di bawah menurut kalian gimana? #fyp #viral #sukses');

        Http::assertSent(function ($request) {
            $body = $request->data();
            $messages = $body['messages'] ?? [];
            $userContent = $messages[1]['content'] ?? '';
            return str_contains($userContent, 'Rahasia Sukses Bisnis')
                && str_contains($userContent, 'ini rahasia sukses')
                && $body['temperature'] === 0.85;
        });

        $clip->refresh();
        $this->assertSame('Gila sih relate parah! Komen di bawah menurut kalian gimana? #fyp #viral #sukses', $clip->suggested_caption);
    }

    public function test_generate_caption_returns_502_when_9router_fails(): void
    {
        config([
            'services.ninerouter.base_url' => 'https://api.9router.test/v1',
            'services.ninerouter.api_key' => 'fake-key',
            'services.ninerouter.model' => 'test-model',
        ]);

        Http::fake([
            'https://api.9router.test/v1/chat/completions' => Http::response('Rate limit exceeded', 429),
        ]);

        $clip = $this->makeClip();

        $response = $this->postJson("/api/clips/{$clip->id}/caption");

        $response->assertStatus(502)
            ->assertJsonPath('message', fn ($msg) => str_contains($msg, 'Gagal terhubung ke 9router'));
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
