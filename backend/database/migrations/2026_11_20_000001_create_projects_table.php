<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->string('youtube_url', 512);
            $table->string('video_title', 255)->nullable();
            $table->unsignedInteger('duration_sec')->nullable();
            $table->longText('transcript_segments_json')->nullable();
            $table->string('status', 32)->default('queued')->index();
            $table->text('error_message')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
