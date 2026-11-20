<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Project extends Model
{
    use HasFactory;

    protected $fillable = [
        'youtube_url',
        'video_title',
        'duration_sec',
        'transcript_segments_json',
        'status',
        'error_message',
    ];

    protected $casts = [
        'duration_sec' => 'integer',
        'transcript_segments_json' => 'array',
    ];

    public function clips(): HasMany
    {
        return $this->hasMany(Clip::class);
    }
}
