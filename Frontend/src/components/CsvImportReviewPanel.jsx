import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, FileCheck2, X } from 'lucide-react';

const EDITABLE_FIELDS = [
  'curr_id',
  'code',
  'course_no',
  'section',
  'department_code',
  'department_id',
  'descriptive_title',
  'units',
  'lec_hrs',
  'lab_hrs',
  'mth_schedule',
  'mth_room_id',
  'tfs_schedule',
  'tfs_room_id',
  'merged',
];

function normalizeValue(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function statusChip(status) {
  if (status === 'error') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'warning') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'skipped') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200';
}

export default function CsvImportReviewPanel({
  open,
  preview,
  confirming,
  confirmError,
  onClose,
  onConfirm,
}) {
  const [selectedRowId, setSelectedRowId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [rowFilter, setRowFilter] = useState('all');
  const [edits, setEdits] = useState({});
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open || !preview) return;
    const firstEditable = preview.rows.find((row) => row.editable) || preview.rows[0];
    setSelectedRowId(firstEditable?.previewRowId || '');
    setSearchText('');
    setRowFilter('all');
    setEdits({});
    setLocalError('');
  }, [open, preview]);

  const filteredRows = useMemo(() => {
    if (!preview?.rows) return [];
    return preview.rows.filter((row) => {
      if (rowFilter !== 'all' && row.status !== rowFilter) return false;
      if (!searchText.trim()) return true;

      const needle = searchText.trim().toLowerCase();
      const key = row.key || {};
      const haystack = [
        String(row.csvRowNumber || ''),
        row.status,
        row.action,
        key.course_no,
        key.section,
        key.curr_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [preview, rowFilter, searchText]);

  const selectedRow = useMemo(() => {
    if (!preview?.rows) return null;
    return preview.rows.find((row) => row.previewRowId === selectedRowId) || null;
  }, [preview, selectedRowId]);

  const selectedRaw = useMemo(() => {
    if (!selectedRow) return {};
    return {
      ...(selectedRow.rawValues || {}),
      ...(edits[selectedRow.previewRowId] || {}),
    };
  }, [selectedRow, edits]);

  const editedRowsCount = useMemo(() => Object.keys(edits).length, [edits]);

  if (!open || !preview) return null;

  const handleFieldChange = (field, value) => {
    if (!selectedRow) return;
    const rowId = selectedRow.previewRowId;

    setEdits((current) => {
      const nextForRow = {
        ...(current[rowId] || {}),
        [field]: value,
      };

      const baseRaw = selectedRow.rawValues || {};
      if (normalizeValue(baseRaw[field]) === normalizeValue(value)) {
        delete nextForRow[field];
      }

      const next = { ...current };
      if (Object.keys(nextForRow).length === 0) {
        delete next[rowId];
      } else {
        next[rowId] = nextForRow;
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    setLocalError('');

    for (const row of preview.rows) {
      if (!row.editable) continue;
      const merged = {
        ...(row.rawValues || {}),
        ...(edits[row.previewRowId] || {}),
      };

      if (!normalizeValue(merged.curr_id)) {
        setLocalError(`Row ${row.csvRowNumber}: curr_id is required before confirm.`);
        return;
      }
      if (!normalizeValue(merged.course_no)) {
        setLocalError(`Row ${row.csvRowNumber}: course_no is required before confirm.`);
        return;
      }
      if (!normalizeValue(merged.section)) {
        setLocalError(`Row ${row.csvRowNumber}: section is required before confirm.`);
        return;
      }
      if (!normalizeValue(merged.department_id) && !normalizeValue(merged.department_code)) {
        setLocalError(`Row ${row.csvRowNumber}: department_id or department_code is required.`);
        return;
      }
    }

    await onConfirm({
      importToken: preview.importToken,
      edits,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/45 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close CSV review"
        className="h-full flex-1 cursor-default"
        onClick={onClose}
      />

      <div className="h-full w-[min(980px,95vw)] border-l border-white/30 bg-slate-50 shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">CSV Review</p>
                <h3 className="text-lg font-semibold text-slate-900">{preview.fileName}</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Total {preview.summary?.totalRows ?? 0} • Valid {preview.summary?.validRows ?? 0} • Errors {preview.summary?.errorRows ?? 0} • Warnings {preview.summary?.warningRows ?? 0}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-12">
            <div className="col-span-5 flex min-h-0 flex-col border-r border-slate-200 bg-white">
              <div className="space-y-2 border-b border-slate-200 p-3">
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search row, course, section"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-primary"
                />
                <select
                  value={rowFilter}
                  onChange={(event) => setRowFilter(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-primary"
                >
                  <option value="all">All rows</option>
                  <option value="valid">Valid</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                  <option value="skipped">Skipped</option>
                </select>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {filteredRows.map((row) => {
                  const isSelected = row.previewRowId === selectedRowId;
                  return (
                    <button
                      key={row.previewRowId}
                      type="button"
                      onClick={() => setSelectedRowId(row.previewRowId)}
                      className={`mb-2 w-full rounded-md border p-2 text-left text-xs transition ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-800">Row {row.csvRowNumber}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusChip(row.status)}`}>
                          {row.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600">
                        {row.key?.course_no || 'No course'} • {row.key?.section || 'No section'}
                      </p>
                      {(row.errors?.length || 0) > 0 && (
                        <p className="mt-1 text-[11px] text-red-700">{row.errors[0]}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="col-span-7 flex min-h-0 flex-col">
              {!selectedRow ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Select a row to review.
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        Action: {selectedRow.action}
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        CSV Row: {selectedRow.csvRowNumber}
                      </span>
                      {selectedRow.warnings?.length > 0 && (
                        <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                          {selectedRow.warnings.length} warning(s)
                        </span>
                      )}
                      {selectedRow.errors?.length > 0 && (
                        <span className="rounded-md bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                          {selectedRow.errors.length} error(s)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <FileCheck2 size={14} className="text-primary" />
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Changed Fields</p>
                      </div>
                      <div className="space-y-2">
                        {(selectedRow.fieldDiffs || []).length === 0 && (
                          <p className="text-xs text-slate-500">No detected field changes.</p>
                        )}
                        {(selectedRow.fieldDiffs || []).map((diff) => (
                          <div key={diff.field} className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                            <p className="font-semibold text-slate-700">{diff.field}</p>
                            <p className="rounded bg-red-50 px-2 py-1 text-red-700">{normalizeValue(diff.oldValue) || 'null'}</p>
                            <p className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{normalizeValue(diff.newValue) || 'null'}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Edit Row Values</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {EDITABLE_FIELDS.map((field) => (
                          <label key={`${selectedRow.previewRowId}-${field}`} className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{field}</span>
                            <input
                              value={normalizeValue(selectedRaw[field])}
                              onChange={(event) => handleFieldChange(field, event.target.value)}
                              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-primary"
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    {(selectedRow.errors?.length || 0) > 0 && (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                        <div className="mb-2 flex items-center gap-2 text-red-700">
                          <AlertCircle size={14} />
                          <p className="text-xs font-bold uppercase tracking-[0.18em]">Row Errors</p>
                        </div>
                        <ul className="space-y-1 text-xs text-red-700">
                          {selectedRow.errors.map((message) => (
                            <li key={`${selectedRow.previewRowId}-${message}`}>{message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="border-t border-slate-200 bg-white p-3">
                {(confirmError || localError) && (
                  <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {localError || confirmError}
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-600">Edited rows: {editedRowsCount}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={confirming}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-60"
                    >
                      {confirming ? <CircleDashed size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      {confirming ? 'Importing...' : 'Confirm Import'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
