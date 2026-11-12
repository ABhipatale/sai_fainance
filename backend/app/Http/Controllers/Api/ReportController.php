<?php

namespace App\Http\Controllers\Api;

use App\Services\ReportService;
use App\Support\Audit;
use Illuminate\Http\Request;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Writer\CSV\Writer as CsvWriter;
use OpenSpout\Writer\XLSX\Writer as XlsxWriter;

class ReportController extends ApiController
{
    public function show(Request $r, string $key)
    {
        abort_unless(in_array($key, ReportService::KEYS, true), 404);
        $f = $r->validate([
            'from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d', 'date' => 'nullable|date_format:Y-m-d',
            'customer_id' => 'nullable|integer', 'collected_by' => 'nullable|integer', 'cash_location_id' => 'nullable|integer',
            'payment_type' => 'nullable|in:cash,upi,bank,other', 'export' => 'nullable|in:csv,xlsx',
        ]);
        $u = $this->user($r);
        $report = ReportService::run($key, $f, $u);

        if (!empty($f['export'])) {
            abort_unless($u->hasPermission('reports.export'), 403);
            Audit::log('report.exported', null, null, ['report' => $key, 'format' => $f['export']]);
            return $this->export($key, $report, $f['export']);
        }
        return $this->ok($report + ['key' => $key]);
    }

    private function export(string $key, array $report, string $format)
    {
        $file = tempnam(sys_get_temp_dir(), 'rep');
        $writer = $format === 'xlsx' ? new XlsxWriter() : new CsvWriter();
        $writer->openToFile($file);
        $writer->addRow(Row::fromValues($report['columns']));
        foreach ($report['rows'] as $row) {
            $writer->addRow(Row::fromValues(array_map(fn ($c) => $this->cell($row[$c] ?? ''), $report['columns'])));
        }
        if (!empty($report['totals'])) {
            $writer->addRow(Row::fromValues(array_map(fn ($c) => $report['totals'][$c] ?? '', $report['columns'])));
        }
        $writer->close();

        $name = $key . '-' . now()->format('Ymd-His') . '.' . $format;
        return response()->download($file, $name, [
            'Content-Type' => $format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=UTF-8',
        ])->deleteFileAfterSend(true);
    }

    /** Neutralise spreadsheet formula injection (=, +, -, @ at the start of text cells). */
    private function cell(mixed $v): mixed
    {
        if (is_string($v) && $v !== '' && !is_numeric($v) && in_array($v[0], ['=', '+', '-', '@'], true)) {
            return "'" . $v;
        }
        return is_numeric($v) ? (str_contains((string) $v, '.') ? (float) $v : (int) $v) : $v;
    }
}
