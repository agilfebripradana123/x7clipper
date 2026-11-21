<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
use App\Models\Clip;
use App\Models\Project;
use App\Support\JobQueue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

    public function upload(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'video' => ['required', 'file', 'mimes:mp4,mov,m4v', 'max:512000'], // maks 500MB
            'subtitle' => ['required', 'file', 'max:10240'], // maks 10MB (vtt/srt)
        ]);

        $project = Project::create([
            'source_type' => 'upload',
            'video_title' => pathinfo($request->file('video')->getClientOriginalName(), PATHINFO_FILENAME),
            'status' => 'queued',
        ]);

        $uploadDir = dirname(base_path()).DIRECTORY_SEPARATOR.'storage'.DIRECTORY_SEPARATOR.'uploads';
        if (!is_dir($uploadDir)) {
            @mkdir($uploadDir, 0777, true);
        }

        $videoExt = $request->file('video')->getClientOriginalExtension() ?: 'mp4';
        $subExt = $request->file('subtitle')->getClientOriginalExtension() ?: 'vtt';

        $videoFileName = "project-{$project->id}-video.{$videoExt}";
        $subFileName = "project-{$project->id}-sub.{$subExt}";

        $request->file('video')->move($uploadDir, $videoFileName);
        $request->file('subtitle')->move($uploadDir, $subFileName);

        $videoRelPath = "storage/uploads/{$videoFileName}";
        $subRelPath = "storage/uploads/{$subFileName}";

        $project->update([
            'local_video_path' => $videoRelPath,
        ]);

        try {
            JobQueue::push('analyze_project', [
                'project_id' => $project->id,
                'source_type' => 'upload',
                'video_path' => $videoRelPath,
                'subtitle_path' => $subRelPath,
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
                'source_type' => $project->source_type,
                'video_title' => $project->video_title,
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
                'source_type' => $project->source_type,
                'youtube_url' => $project->youtube_url,
                'local_video_path' => $project->local_video_path,
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
                    'prepare_status' => $clip->prepare_status,
                    'prepare_error' => $clip->prepare_error,
                    'subtitle_json' => $clip->subtitle_json,
                    'edit_config_json' => $clip->edit_config_json,
                ])->all(),
            ],
        ]);
    }
}
