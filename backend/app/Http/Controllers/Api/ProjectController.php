<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
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
}
