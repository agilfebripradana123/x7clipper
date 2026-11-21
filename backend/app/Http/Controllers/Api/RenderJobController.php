<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Clip;
use App\Models\RenderJob;
use App\Support\JobQueue;
use Illuminate\Http\JsonResponse;
use Throwable;

class RenderJobController extends Controller
{
    public function store(Clip $clip): JsonResponse
    {
        if (
            $clip->prepare_status !== 'ready'
            || $clip->raw_clip_path === null
            || ! is_file($clip->raw_clip_path)
        ) {
            return response()->json(['message' => 'Klip belum siap dirender.'], 409);
        }

        $active = $clip->renderJobs()
            ->whereIn('status', ['queued', 'rendering'])
            ->latest()
            ->first();

        if ($active !== null) {
            return $this->renderResponse($active, 202);
        }

        $renderJob = $clip->renderJobs()->create([
            'status' => 'queued',
            'progress_percent' => 0,
        ]);

        try {
            JobQueue::push('render_clip', [
                'render_job_id' => $renderJob->id,
                'clip_id' => $clip->id,
            ]);
        } catch (Throwable $e) {
            $renderJob->update([
                'status' => 'failed',
                'error_message' => 'Failed to enqueue render job: '.$e->getMessage(),
            ]);

            return $this->renderResponse($renderJob, 503);
        }

        return $this->renderResponse($renderJob, 202);
    }

    public function show(RenderJob $renderJob): JsonResponse
    {
        return $this->renderResponse($renderJob, 200);
    }

    private function renderResponse(RenderJob $renderJob, int $status): JsonResponse
    {
        return response()->json([
            'data' => [
                'id' => $renderJob->id,
                'clip_id' => $renderJob->clip_id,
                'status' => $renderJob->status,
                'progress_percent' => $renderJob->progress_percent,
                'output_url' => $renderJob->output_url,
                'error_message' => $renderJob->error_message,
            ],
        ], $status);
    }
}
