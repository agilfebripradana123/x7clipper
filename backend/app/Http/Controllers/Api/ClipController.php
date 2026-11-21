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
    public function prepare(Clip $clip): JsonResponse
    {
        if (
            $clip->prepare_status === 'ready'
            && $clip->raw_clip_path !== null
            && is_file($clip->raw_clip_path)
        ) {
            return $this->clipResponse($clip, 200);
        }

        if ($clip->prepare_status === 'preparing') {
            return $this->clipResponse($clip, 202);
        }

        $clip->update([
            'prepare_status' => 'preparing',
            'prepare_error' => null,
        ]);

        try {
            JobQueue::push('prepare_clip', ['clip_id' => $clip->id]);
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
            'edit_config.aspect_ratio' => ['sometimes', Rule::in(['16:9', '9:16'])],
            'edit_config.crop_x' => ['sometimes', 'numeric', 'between:0,1'],
            'edit_config.layout_mode' => ['sometimes', Rule::in(['crop', 'blur'])],
            'edit_config.hook_banner' => ['sometimes', 'array'],
            'edit_config.hook_banner.enabled' => ['sometimes', 'boolean'],
            'edit_config.hook_banner.text' => ['sometimes', 'string', 'max:255'],
            'edit_config.cuts' => ['sometimes', 'array'],
            'edit_config.cuts.*.start' => ['required_with:edit_config.cuts', 'numeric', 'min:0'],
            'edit_config.cuts.*.end' => ['required_with:edit_config.cuts', 'numeric', 'min:0'],
            'edit_config.subtitle' => ['sometimes', 'array'],
            'edit_config.subtitle.enabled' => ['sometimes', 'boolean'],
            'edit_config.subtitle.position' => ['sometimes', Rule::in(['top', 'middle', 'bottom'])],
            'edit_config.subtitle.font_size' => ['sometimes', 'integer', 'between:8,200'],
            'edit_config.subtitle.color' => ['sometimes', 'string', 'max:32'],
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

        $clip->update([
            'edit_config_json' => $config === [] ? null : $config,
            'subtitle_json' => array_key_exists('subtitles', $validated)
                ? array_values($validated['subtitles'])
                : $clip->subtitle_json,
        ]);

        return response()->json([
            'data' => [
                'id' => $clip->id,
                'edit_config_json' => $clip->edit_config_json,
                'subtitle_json' => $clip->subtitle_json,
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
