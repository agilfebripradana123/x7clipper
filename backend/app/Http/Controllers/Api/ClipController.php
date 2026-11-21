<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Clip;
use App\Support\JobQueue;
use Illuminate\Http\JsonResponse;
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
