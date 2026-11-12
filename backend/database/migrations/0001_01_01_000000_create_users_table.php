<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Roles & permissions (role-based, editable by Admin from Settings)
        Schema::create('roles', function (Blueprint $t) {
            $t->id();
            $t->string('key', 30)->unique();   // admin | manager | recovery
            $t->string('name', 60);
            $t->timestamps();
        });

        Schema::create('permissions', function (Blueprint $t) {
            $t->id();
            $t->string('key', 60)->unique();
            $t->string('group', 40)->index();
            $t->timestamps();
        });

        Schema::create('role_permissions', function (Blueprint $t) {
            $t->id();
            $t->string('role_key', 30)->index();
            $t->string('permission_key', 60);
            $t->unique(['role_key', 'permission_key']);
        });

        Schema::create('users', function (Blueprint $t) {
            $t->id();
            $t->string('name');
            $t->string('username', 60)->unique();
            $t->string('mobile', 15)->nullable()->index();
            $t->string('email')->nullable()->unique();
            $t->string('password');
            $t->string('role', 30)->index();                 // admin | manager | recovery
            $t->string('status', 10)->default('active')->index(); // active | inactive
            $t->string('photo_path')->nullable();
            $t->string('assigned_area')->nullable();
            $t->foreignId('manager_id')->nullable()->constrained('users')->nullOnDelete();
            $t->unsignedBigInteger('cash_location_id')->nullable()->index();
            $t->string('language', 5)->default('mr');
            $t->timestamp('last_login_at')->nullable();
            $t->rememberToken();
            $t->timestamps();
        });

        Schema::create('cache', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->mediumText('value');
            $table->bigInteger('expiration')->index();
        });

        Schema::create('cache_locks', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->string('owner');
            $table->bigInteger('expiration')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cache_locks');
        Schema::dropIfExists('cache');
        Schema::dropIfExists('users');
        Schema::dropIfExists('role_permissions');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('roles');
    }
};
