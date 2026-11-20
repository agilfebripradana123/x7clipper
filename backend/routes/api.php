<?php

use App\Http\Controllers\Api\ProjectController;
use Illuminate\Support\Facades\Route;

Route::post('/projects', [ProjectController::class, 'store']);
Route::get('/projects/{project}', [ProjectController::class, 'show']);
