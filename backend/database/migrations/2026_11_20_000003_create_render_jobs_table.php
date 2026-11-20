<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('render_jobs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clip_id')->constrained('clips')->cascadeOnDelete();
            $table->string('status', 32)->default('queued')->index();
            $table->unsignedTinyInteger('progress_percent')->default(0);
            $table->string('output_url', 512)->nullable();
            $table->text('error_message')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('render_jobs');
    }
};
