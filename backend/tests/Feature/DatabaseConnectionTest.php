<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DatabaseConnectionTest extends TestCase
{
    public function test_can_connect_to_mysql_database(): void
    {
        $databaseName = DB::connection()->getDatabaseName();
        $this->assertEquals('x7clip', $databaseName);

        $result = DB::select('SELECT 1 as connected');
        $this->assertEquals(1, $result[0]->connected);
    }
}
