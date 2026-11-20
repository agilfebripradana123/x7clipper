<?php

namespace App\Support;

use Illuminate\Support\Facades\Redis;

class JobQueue
{
    public static function push(string $type, array $data): void
    {
        Redis::connection()->lpush(
            config('services.job_queue.list', 'x7:jobs'),
            json_encode(['type' => $type, ...$data], JSON_UNESCAPED_SLASHES)
        );
    }
}
