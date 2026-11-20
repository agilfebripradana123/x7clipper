<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Clip extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id',
        'title',
        'start_sec',
        'end_sec',
        'viral_score',
        'hook_type',
        'ai_reason',
        'suggested_caption',
        'raw_clip_path',
        'subtitle_json',
        'edit_config_json',
    ];

    protected $casts = [
        'start_sec' => 'float',
        'end_sec' => 'float',
        'viral_score' => 'integer',
        'subtitle_json' => 'array',
        'edit_config_json' => 'array',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function renderJobs(): HasMany
    {
        return $this->hasMany(RenderJob::class);
    }
}
