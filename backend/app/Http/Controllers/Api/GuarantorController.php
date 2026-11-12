<?php

namespace App\Http\Controllers\Api;

use App\Models\Customer;
use App\Models\Guarantor;
use App\Support\Audit;
use App\Support\Media;
use App\Support\Present;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/** Guarantors belong to the customer, so they can be reused across all of the customer's khatas. */
class GuarantorController extends ApiController
{
    private function rules(): array
    {
        return [
            'name' => 'required|string|max:150',
            'mobile' => 'nullable|digits:10',
            'address' => 'nullable|string|max:500',
            'village' => 'nullable|string|max:120',
            'taluka' => 'nullable|string|max:120',
            'district' => 'nullable|string|max:120',
            'lat' => 'nullable|numeric|between:-90,90',
            'lng' => 'nullable|numeric|between:-180,180',
            'aadhaar_no' => 'nullable|digits:12',
            'photo' => 'nullable|image|max:4096',
        ];
    }

    public function index(Request $r, Customer $customer)
    {
        Gate::authorize('view', $customer);
        $u = $this->user($r);
        return $this->ok($customer->guarantors()->get()->map(fn ($g) => Present::guarantor($g, $u)));
    }

    public function store(Request $r, Customer $customer)
    {
        Gate::authorize('update', $customer);
        $d = $r->validate($this->rules());
        $g = $customer->guarantors()->create(collect($d)->except('photo')->all() + ['photo_path' => Media::store($r->file('photo'), 'photos')]);
        Audit::log('guarantor.created', $g, null, ['customer_id' => $customer->id, 'name' => $g->name]);
        return $this->ok(Present::guarantor($g, $this->user($r)), 'Guarantor saved', 201);
    }

    public function update(Request $r, Guarantor $guarantor)
    {
        Gate::authorize('update', $guarantor->customer_id ? Customer::findOrFail($guarantor->customer_id) : abort(404));
        $d = $r->validate($this->rules());
        $guarantor->fill(collect($d)->except('photo')->all());
        $guarantor->photo_path = Media::replace($r->file('photo'), $guarantor->photo_path, 'photos');
        $guarantor->save();
        Audit::log('guarantor.updated', $guarantor);
        return $this->ok(Present::guarantor($guarantor, $this->user($r)), 'Guarantor updated');
    }
}
