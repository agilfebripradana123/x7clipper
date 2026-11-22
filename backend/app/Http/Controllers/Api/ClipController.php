<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Clip;
use App\Support\JobQueue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

class ClipController extends Controller
{
    public function prepare(Request $request, Clip $clip): JsonResponse
    {
        $force = (bool) $request->input('force', false);

        if (
            ! $force
            && $clip->prepare_status === 'ready'
            && $clip->raw_clip_path !== null
            && is_file($clip->raw_clip_path)
        ) {
            return $this->clipResponse($clip, 200);
        }

        if (! $force && $clip->prepare_status === 'preparing') {
            return $this->clipResponse($clip, 202);
        }

        $clip->update([
            'prepare_status' => 'preparing',
            'prepare_error' => null,
        ]);

        try {
            JobQueue::push('prepare_clip', [
                'clip_id' => $clip->id,
                'force' => $force,
            ]);
        } catch (Throwable $e) {
            $clip->update([
                'prepare_status' => 'failed',
                'prepare_error' => 'Failed to enqueue prepare job: '.$e->getMessage(),
            ]);

            return $this->clipResponse($clip, 503);
        }

        return $this->clipResponse($clip, 202);
    }

    public function updateConfig(Request $request, Clip $clip): JsonResponse
    {
        $validated = $request->validate([
            'edit_config' => ['sometimes', 'array'],
            'edit_config.trim_start' => ['sometimes', 'numeric', 'min:0'],
            'edit_config.trim_end' => ['sometimes', 'numeric', 'min:0'],
            'edit_config.aspect_ratio' => ['sometimes', Rule::in(['9:16', '1:1', '4:3', '16:9'])],
            'edit_config.crop_x' => ['sometimes', 'numeric', 'between:0,1'],
            'edit_config.layout_mode' => ['sometimes', Rule::in(['crop', 'blur', 'full_crop', 'blur_bg'])],
            'edit_config.hook_banner' => ['sometimes', 'array'],
            'edit_config.hook_banner.enabled' => ['sometimes', 'boolean'],
            'edit_config.hook_banner.text' => ['sometimes', 'string', 'max:255'],
            'edit_config.subtitle_position' => ['sometimes', Rule::in(['top', 'middle', 'bottom'])],
            'edit_config.subtitle_offset_sec' => ['sometimes', 'numeric', 'between:-2,2'],
            'edit_config.subtitle_font_size' => ['sometimes', 'integer', 'between:32,96'],
            'edit_config.hook_font' => ['sometimes', Rule::in(['montserrat', 'poppins', 'anton', 'bebas', 'oswald', 'jakarta'])],
            'edit_config.subtitle_font' => ['sometimes', Rule::in(['montserrat', 'poppins', 'anton', 'bebas', 'oswald', 'jakarta'])],
            'edit_config.cuts' => ['sometimes', 'array'],
            'edit_config.cuts.*.start' => ['required_with:edit_config.cuts', 'numeric', 'min:0'],
            'edit_config.cuts.*.end' => ['required_with:edit_config.cuts', 'numeric', 'min:0'],
            'edit_config.subtitle' => ['sometimes', 'array'],
            'edit_config.subtitle.enabled' => ['sometimes', 'boolean'],
            'edit_config.subtitle.position' => ['sometimes', Rule::in(['top', 'middle', 'bottom'])],
            'edit_config.subtitle.font_size' => ['sometimes', 'integer', 'between:8,200'],
            'edit_config.subtitle.color' => ['sometimes', 'string', 'max:32'],
            'suggested_caption' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'subtitles' => ['sometimes', 'array', 'max:2000'],
            'subtitles.*.start' => ['required', 'numeric', 'min:0'],
            'subtitles.*.end' => ['required', 'numeric', 'min:0'],
            'subtitles.*.text' => ['required', 'string', 'max:500'],
        ]);

        $config = array_merge($clip->edit_config_json ?? [], $validated['edit_config'] ?? []);
        $duration = round((float) $clip->end_sec - (float) $clip->start_sec, 3);
        $trimStart = (float) ($config['trim_start'] ?? 0);
        $trimEnd = (float) ($config['trim_end'] ?? $duration);

        $errors = [];

        if ($trimEnd <= $trimStart) {
            $errors['edit_config.trim_end'] = 'trim_end harus lebih besar dari trim_start.';
        } elseif ($trimStart > $duration || $trimEnd > $duration + 0.001) {
            $errors['edit_config.trim_end'] = "Rentang trim melebihi durasi klip ({$duration} detik).";
        }

        if (isset($config['cuts']) && is_array($config['cuts'])) {
            foreach ($config['cuts'] as $index => $cut) {
                $cStart = (float) ($cut['start'] ?? 0);
                $cEnd = (float) ($cut['end'] ?? 0);
                if ($cEnd <= $cStart) {
                    $errors["edit_config.cuts.{$index}.end"] = 'end potongan harus lebih besar dari start.';
                } elseif ($cStart > $duration || $cEnd > $duration + 0.001) {
                    $errors["edit_config.cuts.{$index}.end"] = "Potongan melebihi durasi klip ({$duration} detik).";
                }
            }
        }

        foreach ($validated['subtitles'] ?? [] as $index => $line) {
            if ((float) $line['end'] <= (float) $line['start']) {
                $errors["subtitles.{$index}.end"] = 'end harus lebih besar dari start.';
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $updateData = [
            'edit_config_json' => $config === [] ? null : $config,
            'subtitle_json' => array_key_exists('subtitles', $validated)
                ? array_values($validated['subtitles'])
                : $clip->subtitle_json,
        ];

        if (array_key_exists('suggested_caption', $validated)) {
            $updateData['suggested_caption'] = $validated['suggested_caption'];
        }

        $clip->update($updateData);

        return response()->json([
            'data' => [
                'id' => $clip->id,
                'edit_config_json' => $clip->edit_config_json,
                'subtitle_json' => $clip->subtitle_json,
                'suggested_caption' => $clip->suggested_caption,
            ],
        ]);
    }

    public function generateCaption(Clip $clip): JsonResponse
    {
        $transcript = '';
        if (is_array($clip->subtitle_json)) {
            $texts = array_column($clip->subtitle_json, 'text');
            $transcript = implode(' ', array_slice($texts, 0, 30));
        }

        $caption = null;
        $baseUrl = config('services.ninerouter.base_url');
        $apiKey = config('services.ninerouter.api_key');
        $model = config('services.ninerouter.model');

        if ($baseUrl && $apiKey) {
            try {
                $response = \Illuminate\Support\Facades\Http::timeout(30)
                    ->withToken($apiKey)
                    ->post(rtrim($baseUrl, '/').'/chat/completions', [
                        'model' => $model,
                        'temperature' => 0.7,
                        'messages' => [
                            [
                                'role' => 'system',
                                'content' => "Kamu adalah Social Media Caption Specialist untuk TikTok, Instagram Reels, dan YouTube Shorts Gen Z Indonesia.\nBuat 1 caption media sosial yang natural, relatable, punchy, ga kaku/baku (gaya Gen Z santai, ada hook/reaksi pembuka yang memancing rasa penasaran, pancingan diskusi di kolom komentar, dan diakhiri TEPAT 3 hashtag relevan).\nContoh format:\n[Reaksi/hook santai relate]\n[1-2 kalimat esensi klip + pancingan komen]\n\n#hashtag1 #hashtag2 #hashtag3\nOutput HANYA teks caption mentah.",
                            ],
                            [
                                'role' => 'user',
                                'content' => "Judul: {$clip->title}\nTranskrip singkat: {$transcript}",
                            ],
                        ],
                    ]);

                if ($response->successful()) {
                    $caption = trim($response->json('choices.0.message.content', ''));
                    $caption = trim($caption, "\"' \t\n\r\0\x0B");
                }
            } catch (Throwable) {
                // Graceful fallback
            }
        }

        if (empty($caption)) {
            $words = array_values(array_filter(explode(' ', (string) preg_replace('/[^A-Za-z0-9 ]/', '', (string) $clip->title))));
            $tags = array_slice($words, 0, 3);
            if (count($tags) < 3) {
                $tags = array_pad($tags, 3, 'fyp');
            }
            $hashtags = '#'.implode(' #', array_map('strtolower', $tags));
            $caption = "Gak nyangka banget bakal gini... 🤯 Menurut kalian gimana nih guys?\n\n{$hashtags}";
        }

        $clip->update(['suggested_caption' => $caption]);

        return response()->json([
            'data' => [
                'id' => $clip->id,
                'suggested_caption' => $clip->suggested_caption,
            ],
        ]);
    }

    public function video(Clip $clip)
    {
        if ($clip->raw_clip_path === null || ! is_file($clip->raw_clip_path)) {
            abort(404, 'Raw clip belum tersedia.');
        }

        return response()->file($clip->raw_clip_path, ['Content-Type' => 'video/mp4']);
    }

    private function clipResponse(Clip $clip, int $status): JsonResponse
    {
        return response()->json([
            'data' => [
                'id' => $clip->id,
                'prepare_status' => $clip->prepare_status,
                'prepare_error' => $clip->prepare_error,
                'raw_clip_path' => $clip->raw_clip_path,
            ],
        ], $status);
    }
}
