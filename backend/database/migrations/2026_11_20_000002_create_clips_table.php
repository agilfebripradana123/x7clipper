<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clips', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained('projects')->cascadeOnDelete();
            $table->string('title', 255);
            $table->decimal('start_sec', 8, 3);
            $table->decimal('end_sec', 8, 3);
            $table->unsignedTinyInteger('viral_score')->index();
            $table->string('hook_type', 64);
            $table->text('ai_reason')->nullable();
            $table->text('suggested_caption')->nullable();
            $table->string('raw_clip_path', 512)->nullable();
            $table->longText('subtitle_json')->nullable();
            $table->longText('edit_config_json')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clips');
    }
};
