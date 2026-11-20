<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RenderJob extends Model
{
    use HasFactory;

    protected $fillable = [
        'clip_id',
        'status',
        'progress_percent',
        'output_url',
        'error_message',
    ];

    protected $casts = [
        'progress_percent' => 'integer',
    ];

    public function clip(): BelongsTo
    {
        return $this->belongsTo(Clip::class);
    }
}
