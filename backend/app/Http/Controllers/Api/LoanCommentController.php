<?php

namespace App\Http\Controllers\Api;

use App\Models\LoanAccount;
use App\Models\LoanComment;
use App\Support\Audit;
use App\Support\Scope;
use Illuminate\Http\Request;

/** Short field comments on a khata. Everyone who can see the customer can read; collectors can write. */
class LoanCommentController extends ApiController
{
    private function guard(Request $r, LoanAccount $loan): void
    {
        abort_unless(Scope::canSeeCustomer($this->user($r), $loan->customer_id), 403, 'Not allowed.');
    }

    private function row(LoanComment $c): array
    {
        return ['id' => $c->id, 'body' => $c->body, 'user_id' => $c->user_id, 'user_name' => $c->user?->name, 'created_at' => $c->created_at?->toDateTimeString()];
    }

    public function index(Request $r, LoanAccount $loanAccount)
    {
        $this->guard($r, $loanAccount);
        return $this->ok(LoanComment::with('user')->where('loan_account_id', $loanAccount->id)->orderByDesc('id')->limit(50)->get()->map(fn ($c) => $this->row($c)));
    }

    public function store(Request $r, LoanAccount $loanAccount)
    {
        $this->guard($r, $loanAccount);
        $d = $r->validate(['body' => 'required|string|min:1|max:500']);
        $c = LoanComment::create(['loan_account_id' => $loanAccount->id, 'user_id' => $this->user($r)->id, 'body' => trim($d['body'])]);
        Audit::log('loan.comment', $loanAccount, null, ['comment_id' => $c->id]);
        return $this->ok($this->row($c->load('user')), 'Saved', 201);
    }
}
