<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'ninerouter' => (function () {
        $baseUrl = env('NINEROUTER_BASE_URL');
        $apiKey = env('NINEROUTER_API_KEY');
        $model = env('NINEROUTER_MODEL');

        if ((empty($baseUrl) || empty($apiKey) || empty($model)) && file_exists(base_path('../.env'))) {
            $parentEnv = file_get_contents(base_path('../.env'));
            if (empty($baseUrl) && preg_match('/^NINEROUTER_BASE_URL\s*=\s*(.+)$/m', $parentEnv, $m)) {
                $baseUrl = trim(trim($m[1]), '"\'');
            }
            if (empty($apiKey) && preg_match('/^NINEROUTER_API_KEY\s*=\s*(.+)$/m', $parentEnv, $m)) {
                $apiKey = trim(trim($m[1]), '"\'');
            }
            if (empty($model) && preg_match('/^NINEROUTER_MODEL\s*=\s*(.+)$/m', $parentEnv, $m)) {
                $model = trim(trim($m[1]), '"\'');
            }
        }

        return [
            'base_url' => $baseUrl ?: 'http://localhost:20128/v1',
            'api_key' => $apiKey ?: '',
            'model' => $model ?: 'bansossss',
        ];
    })(),

];
