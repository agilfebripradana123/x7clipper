<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
use App\Models\Clip;
use App\Models\Project;
use App\Support\JobQueue;
use Illuminate\Http\JsonResponse;
use Throwable;

class ProjectController extends Controller
{
    public function store(StoreProjectRequest $request): JsonResponse
    {
        $project = Project::create([
            'youtube_url' => $request->validated('youtube_url'),
            'status' => 'queued',
        ]);

        try {
            JobQueue::push('analyze_project', [
                'project_id' => $project->id,
                'attempt' => 1,
            ]);
        } catch (Throwable $e) {
            $project->update([
                'status' => 'failed',
                'error_message' => 'Failed to enqueue analysis job: '.$e->getMessage(),
            ]);

            return response()->json(['message' => 'Failed to enqueue analysis job.'], 503);
        }

        return response()->json([
            'data' => [
                'id' => $project->id,
                'youtube_url' => $project->youtube_url,
                'status' => $project->status,
                'created_at' => $project->created_at?->toISOString(),
            ],
        ], 201);
    }

    public function show(Project $project): JsonResponse
    {
        $project->load(['clips' => fn ($query) => $query->orderByDesc('viral_score')]);

        return response()->json([
            'data' => [
                'id' => $project->id,
                'youtube_url' => $project->youtube_url,
                'video_title' => $project->video_title,
                'duration_sec' => $project->duration_sec,
                'status' => $project->status,
                'error_message' => $project->error_message,
                'created_at' => $project->created_at?->toISOString(),
                'clips' => $project->clips->map(fn (Clip $clip) => [
                    'id' => $clip->id,
                    'title' => $clip->title,
                    'start_sec' => $clip->start_sec,
                    'end_sec' => $clip->end_sec,
                    'viral_score' => $clip->viral_score,
                    'hook_type' => $clip->hook_type,
                    'ai_reason' => $clip->ai_reason,
                    'suggested_caption' => $clip->suggested_caption,
                    'raw_clip_path' => $clip->raw_clip_path,
                ])->all(),
            ],
        ]);
    }
}
