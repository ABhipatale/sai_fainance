<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // field notes written by recovery staff / managers on a khata ("will pay next week", "not at home" …)
        Schema::create('loan_comments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('loan_account_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained();
            $t->string('body', 500);
            $t->timestamps();
            $t->index(['loan_account_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('loan_comments');
    }
};
