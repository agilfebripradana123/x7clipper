<?php

use App\Http\Controllers\Api\ClipController;
use App\Http\Controllers\Api\ProjectController;
use Illuminate\Support\Facades\Route;

Route::post('/projects', [ProjectController::class, 'store']);
Route::get('/projects/{project}', [ProjectController::class, 'show']);
Route::post('/clips/{clip}/prepare', [ClipController::class, 'prepare']);
Route::get('/clips/{clip}/video', [ClipController::class, 'video']);
