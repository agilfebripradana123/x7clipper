<?php

use App\Http\Controllers\Api\ClipController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\RenderJobController;
use Illuminate\Support\Facades\Route;

Route::post('/projects', [ProjectController::class, 'store']);
Route::post('/projects/upload', [ProjectController::class, 'upload']);
Route::get('/projects/{project}', [ProjectController::class, 'show']);
Route::patch('/clips/{clip}/config', [ClipController::class, 'updateConfig']);
Route::post('/clips/{clip}/prepare', [ClipController::class, 'prepare']);
Route::get('/clips/{clip}/video', [ClipController::class, 'video']);
Route::post('/clips/{clip}/render', [RenderJobController::class, 'store']);
Route::get('/render-jobs/{renderJob}', [RenderJobController::class, 'show']);
Route::get('/render-jobs/{renderJob}/download', [RenderJobController::class, 'download']);
