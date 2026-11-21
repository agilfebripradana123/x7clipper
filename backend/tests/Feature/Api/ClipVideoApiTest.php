<?php

namespace Tests\Feature\Api;

use App\Models\Clip;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClipVideoApiTest extends TestCase
{
    use RefreshDatabase;

    private ?string $tempFile = null;

    protected function tearDown(): void
    {
        if ($this->tempFile !== null) {
            @unlink($this->tempFile);
            $this->tempFile = null;
        }

        parent::tearDown();
    }

    private function makeClip(?string $rawClipPath): Clip
    {
        $project = Project::create([
            'youtube_url' => 'https://youtu.be/dQw4w9WgXcQ',
            'video_title' => 'Video Uji Coba',
        ]);

        return $project->clips()->create([
            'title' => 'Hook Menarik',
            'start_sec' => 10.0,
            'end_sec' => 40.0,
            'viral_score' => 90,
            'hook_type' => 'story',
            'raw_clip_path' => $rawClipPath,
        ]);
    }

    private function makeTempVideo(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'clip_');
        file_put_contents($path, '0123456789abcdef');
        $this->tempFile = $path;

        return $path;
    }

    public function test_missing_raw_clip_path_returns_404(): void
    {
        $clip = $this->makeClip(null);

        $this->getJson("/api/clips/{$clip->id}/video")->assertStatus(404);
    }

    public function test_existing_file_returns_video_with_range_headers(): void
    {
        $clip = $this->makeClip($this->makeTempVideo());

        $response = $this->get("/api/clips/{$clip->id}/video");

        $response->assertStatus(200);
        $this->assertSame('bytes', $response->headers->get('Accept-Ranges'));
        $this->assertStringStartsWith('video/mp4', $response->headers->get('Content-Type'));
    }

    public function test_range_request_returns_206_with_content_range(): void
    {
        $clip = $this->makeClip($this->makeTempVideo());

        $response = $this->get("/api/clips/{$clip->id}/video", ['Range' => 'bytes=0-3']);

        $response->assertStatus(206);
        $this->assertSame('bytes 0-3/16', $response->headers->get('Content-Range'));
    }
}
