<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->string('youtube_url', 512)->nullable()->change();
            $table->string('source_type', 32)->default('youtube')->after('id');
            $table->string('local_video_path', 512)->nullable()->after('youtube_url');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->string('youtube_url', 512)->nullable(false)->change();
            $table->dropColumn(['source_type', 'local_video_path']);
        });
    }
};
