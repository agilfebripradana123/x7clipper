<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProjectRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'youtube_url' => [
                'required',
                'string',
                'max:512',
                'regex:/^https:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|live\/|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11,}(?:[?&].*)?$/',
            ],
        ];
    }
}
