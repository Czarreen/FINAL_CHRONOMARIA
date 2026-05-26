import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ClipboardList,
  Edit3,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  FileDown,
  RefreshCcw,
  Search,
  Sparkles,
  Table2,
  X,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, Table as DocTable, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { formatScheduleTimeDisplay } from '../utils/scheduleUtils';
import { fetchGaPreFlight } from '../services/gaApi';
import { fetchRooms } from '../services/roomsApi';
import { updateFacultyLoadingLock } from '../services/facultyApi';

let ROOMS_MAP = {};

const FINALIZE_STORAGE_KEY = 'facultyLoadingFinalizeDraft';
const SOURCE_RESULT_KEY = 'facultyLoadingLastResult';

const COLUMN_DEFS = [
  { key: 'curr_id', label: 'Curr ID', type: 'text' },
  { key: 'section', label: 'Section', type: 'text' },
  { key: 'code', label: 'Course Code', type: 'text' },
  { key: 'course_no', label: 'Course No', type: 'text' },
  { key: 'descriptive_title', label: 'Descriptive Title', type: 'text' },
  { key: 'units', label: 'Units', type: 'number' },
  { key: 'lec_hrs', label: 'Lec Hrs', type: 'number' },
  { key: 'lab_hrs', label: 'Lab Hrs', type: 'number' },
  { key: 'mth_schedule', label: 'MTH Schedule', type: 'text' },
  { key: 'mth_room', label: 'MTH Room', type: 'text' },
  { key: 'tfs_schedule', label: 'TFS Schedule', type: 'text' },
  { key: 'tfs_room', label: 'TFS Room', type: 'text' },
  { key: 'department_name', label: 'Department', type: 'text' },
  { key: 'faculty_name', label: 'Faculty', type: 'text' },
  { key: 'locked', label: 'Locked', type: 'boolean' },
  { key: 'merged', label: 'Merged', type: 'boolean' },
  { key: 'load_status', label: 'Status', type: 'text' },
];

const DEFAULT_COLUMN_ORDER = COLUMN_DEFS.map((column) => column.key);
const DEFAULT_SORT = { key: 'section', direction: 'asc' };

const COLUMN_MIN_WIDTHS = {
  curr_id: '8rem',
  section: '8rem',
  code: '9rem',
  course_no: '8rem',
  descriptive_title: '18rem',
  units: '6rem',
  lec_hrs: '7rem',
  lab_hrs: '7rem',
  mth_schedule: '11rem',
  mth_room: '10rem',
  tfs_schedule: '11rem',
  tfs_room: '10rem',
  department_name: '12rem',
  faculty_name: '12rem',
  merged: '7rem',
  locked: '6rem',
  load_status: '10rem',
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

function timestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeRow(row, index) {
  return {
    id: row?.id ?? row?.row_id ?? `faculty-loading-finalize-${index}`,
    facloading_id: row?.facloading_id ?? null,   // DB primary key — enables lock persistence
    curr_id: row?.curr_id ?? '',
    section: row?.section ?? '',
    code: row?.code ?? '',
    course_no: row?.course_no ?? '',
    descriptive_title: row?.descriptive_title ?? '',
    units: row?.units ?? '',
    lec_hrs: row?.lec_hrs ?? '',
    lab_hrs: row?.lab_hrs ?? '',
    mth_schedule: row?.mth_schedule ?? '',
    mth_room: row?.mth_room ?? row?.mth_room_id ?? row?.mth_room_label ?? '',
    tfs_schedule: row?.tfs_schedule ?? '',
    tfs_room: row?.tfs_room ?? row?.tfs_room_id ?? row?.tfs_room_label ?? '',
    department_name: row?.department_name ?? '',
    faculty_name: row?.faculty_name ?? '',
    merged: Boolean(row?.merged),
    locked: Boolean(row?.locked),
    load_status: row?.load_status ?? '',
  };
}

function extractStoredDraftRows() {
  if (typeof window === 'undefined') return [];

  const draft = parseJson(localStorage.getItem(FINALIZE_STORAGE_KEY));
  if (draft?.rows?.length) {
    return draft.rows.map((row, index) => normalizeRow(row, index));
  }

  return [];
}

function extractLatestSourceRows() {
  if (typeof window === 'undefined') return [];

  const result = parseJson(localStorage.getItem(SOURCE_RESULT_KEY));
  const rows = result?.report?.generated_rows || result?.assignments || [];
  return rows.map((row, index) => normalizeRow(row, index));
}

function getInitialState() {
  if (typeof window === 'undefined') {
    return {
      rows: [],
      columnOrder: DEFAULT_COLUMN_ORDER,
      visibleColumnKeys: DEFAULT_COLUMN_ORDER,
      searchText: '',
      sortConfig: DEFAULT_SORT,
    };
  }

  const draft = parseJson(localStorage.getItem(FINALIZE_STORAGE_KEY));
  const draftRows = extractStoredDraftRows();
  const sourceRows = extractLatestSourceRows();

  // Merge saved draft column order/visibility with current column defs so new columns appear
  const allKeys = COLUMN_DEFS.map((c) => c.key);

  const savedOrder = Array.isArray(draft?.columnOrder) ? draft.columnOrder.slice() : [];
  const mergedOrder = savedOrder.length ? [...savedOrder] : DEFAULT_COLUMN_ORDER.slice();
  for (const key of allKeys) {
    if (!mergedOrder.includes(key)) mergedOrder.push(key);
  }

  const savedVisible = Array.isArray(draft?.visibleColumnKeys) ? draft.visibleColumnKeys.slice() : [];
  const mergedVisible = savedVisible.length ? [...savedVisible] : DEFAULT_COLUMN_ORDER.slice();
  for (const key of allKeys) {
    if (!mergedVisible.includes(key)) mergedVisible.push(key);
  }

  return {
    rows: draftRows.length ? draftRows : sourceRows,
    columnOrder: mergedOrder,
    visibleColumnKeys: mergedVisible,
    searchText: typeof draft?.searchText === 'string' ? draft.searchText : '',
    sortConfig: draft?.sortConfig?.key ? draft.sortConfig : DEFAULT_SORT,
  };
}

function valueForDisplay(row, columnKey) {
  const value = row?.[columnKey];

  if (columnKey === 'merged') {
    return value ? 'Yes' : 'No';
  }

  if (columnKey === 'locked') {
    return value ? 'Yes' : 'No';
  }

  if (columnKey === 'units') {
    return value === '' || value === null || value === undefined ? '' : String(value);
  }

  if (columnKey === 'mth_schedule' || columnKey === 'tfs_schedule') {
    return formatScheduleTimeDisplay(value) || String(value ?? '');
  }

  if (columnKey === 'mth_room' || columnKey === 'tfs_room') {
    const raw = String(value ?? '');
    if (!raw) return '';
    return ROOMS_MAP[raw] || raw;
  }

  return String(value ?? '');
}

function valueForSearch(row) {
  return COLUMN_DEFS.map((column) => valueForDisplay(row, column.key)).join(' ').toLowerCase();
}

function getExportValue(row, columnKey) {
  const value = row?.[columnKey];

  if (columnKey === 'total_contact_hrs') {
    const lec = toNumber(row?.lec_hrs);
    const lab = toNumber(row?.lab_hrs);
    const total = lec + lab;
    return total === 0 ? '' : total;
  }
  if (columnKey === 'merged') return value ? 'Yes' : 'No';
  if (columnKey === 'units') return value === '' || value === null || value === undefined ? '' : value;
  if (columnKey === 'mth_schedule' || columnKey === 'tfs_schedule') return formatScheduleTimeDisplay(value) || value || '';
  if (columnKey === 'mth_room' || columnKey === 'tfs_room') {
    const raw = String(value ?? '');
    return ROOMS_MAP[raw] || raw || '';
  }
  return value ?? '';
}

function buildExportMatrix(rows, columns) {
  const headers = columns.map((column) => column.label);
  const body = rows.map((row) => columns.map((column) => getExportValue(row, column.key)));
  return { headers, body };
}

/**
 * For exports, merge lec_hrs + lab_hrs into a single "Total Contact Hrs" column
 * at the position of whichever appears first. Both source columns are removed.
 */
function toExportColumns(columns) {
  const hasLec = columns.some((c) => c.key === 'lec_hrs');
  const hasLab = columns.some((c) => c.key === 'lab_hrs');
  if (!hasLec && !hasLab) return columns;

  const totalCol = { key: 'total_contact_hrs', label: 'Total Contact Hrs', type: 'number' };
  const result = [];
  let inserted = false;

  for (const col of columns) {
    if (col.key === 'lec_hrs' || col.key === 'lab_hrs') {
      if (!inserted) {
        result.push(totalCol);
        inserted = true;
      }
      // drop individual lec/lab columns from export
    } else {
      result.push(col);
    }
  }

  return result;
}

function exportCsv(filename, rows, columns) {
  const { headers, body } = buildExportMatrix(rows, columns);
  const lines = [headers.map((header) => JSON.stringify(header)).join(',')];

  for (const row of body) {
    lines.push(row.map((value) => JSON.stringify(String(value ?? ''))).join(','));
  }

  downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

function exportXlsx(filename, rows, columns) {
  const { headers, body } = buildExportMatrix(rows, columns);
  const worksheetData = [headers, ...body];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Faculty Loading');
  XLSX.writeFile(workbook, filename);
}

async function exportWord(filename, rows, columns) {
  const { headers, body } = buildExportMatrix(rows, columns);
  const table = new DocTable({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    rows: [
      new TableRow({
        children: headers.map((header) => (
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })],
          })
        )),
      }),
      ...body.map((row) => (
        new TableRow({
          children: row.map((value) => (
            new TableCell({
              children: [new Paragraph({ text: String(value ?? '') })],
            })
          )),
        })
      )),
    ],
  });

  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: 'Faculty Loading Finalized List', bold: true, size: 30 })] }),
          new Paragraph({ children: [new TextRun({ text: `Rows exported: ${rows.length}` })] }),
          table,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  downloadBlob(blob, filename);
}

function exportPdf(filename, rows, columns) {
  const { headers, body } = buildExportMatrix(rows, columns);
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.text('Faculty Loading Finalized List', 40, 40);
  doc.setFontSize(10);
  doc.text(`Rows exported: ${rows.length}`, 40, 58);

  autoTable(doc, {
    head: [headers],
    body,
    startY: 74,
    styles: {
      fontSize: 8,
      cellPadding: 3,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [32, 44, 90],
      textColor: 255,
    },
    alternateRowStyles: {
      fillColor: [246, 248, 252],
    },
  });

  doc.save(filename);
}

function StatChip({ label, value }) {
  return (
    <span className="rounded-full border border-white/60 bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
      {label}: {value}
    </span>
  );
}

export default function FacultyLoadingFinalizeView({ onNavigate } = {}) {
  const initialState = useMemo(() => getInitialState(), []);
  const [rows, setRows] = useState(initialState.rows);
  const [columnOrder, setColumnOrder] = useState(initialState.columnOrder);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(new Set(initialState.visibleColumnKeys));
  const [searchText, setSearchText] = useState(initialState.searchText);
  const [sortConfig, setSortConfig] = useState(initialState.sortConfig);
  const [page, setPage] = useState(initialState.page ?? 1);
  const [pageSize, setPageSize] = useState(initialState.pageSize ?? 25);
  const [statusMessage, setStatusMessage] = useState('');
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const [roomsMapState, setRoomsMapState] = useState({});


  useEffect(() => {
    localStorage.setItem(
      FINALIZE_STORAGE_KEY,
      JSON.stringify({
        rows,
        columnOrder,
        visibleColumnKeys: Array.from(visibleColumnKeys),
        searchText,
        sortConfig,
        page,
        pageSize,
      }),
    );
  }, [rows, columnOrder, visibleColumnKeys, searchText, sortConfig]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { rows: roomRows } = await fetchRooms({ page: 1, limit: 100000 });
        const map = {};
        for (const r of roomRows) {
          const id = String(r.room_id ?? r.id ?? '');
          if (id) map[id] = r.room_name ?? r.name ?? '';
        }
        if (mounted) {
          setRoomsMapState(map);
          ROOMS_MAP = map;
        }
      } catch (err) {
        // ignore fetch errors - rooms may not be available in some contexts
        // console.error('Failed to load rooms:', err);
      }
    })();

    return () => { mounted = false; };
  }, []);

  // Seed from DB if localStorage is empty; otherwise sync locked values from DB
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const preflight = await fetchGaPreFlight();
        const dbRows = Array.isArray(preflight?.faculty_loading) ? preflight.faculty_loading : [];
        if (!mounted || dbRows.length === 0) return;

        setRows((current) => {
          // Build a map of facloading_id → { locked, facloading_id } from DB
          const dbMap = new Map();
          dbRows.forEach((r) => {
            if (r?.facloading_id != null) {
              dbMap.set(r.facloading_id, { locked: Boolean(r.locked), facloading_id: r.facloading_id });
            }
          });

          if (current.length === 0) {
            // Cold start — load everything from DB
            return dbRows.map((row, index) => normalizeRow(row, index));
          }

          // Rows already loaded (from localStorage) — sync locked + facloading_id from DB
          return current.map((r) => {
            if (r.facloading_id != null && dbMap.has(r.facloading_id)) {
              const db = dbMap.get(r.facloading_id);
              return { ...r, locked: db.locked };
            }
            return r;
          });
        });
      } catch {
        // preflight unavailable — keep current state
      }
    })();

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If source rows include room fields, ensure the room columns are visible
  useEffect(() => {
    const hasRooms = rows.some((r) => (r?.mth_room || r?.mth_room_id || r?.mth_room_label || r?.mth_room === 0) || (r?.tfs_room || r?.tfs_room_id || r?.tfs_room_label || r?.tfs_room === 0));
    if (!hasRooms) return;

    setVisibleColumnKeys((current) => {
      const next = new Set(current);
      if (!next.has('mth_room')) next.add('mth_room');
      if (!next.has('tfs_room')) next.add('tfs_room');
      return next;
    });
  }, [rows]);

  const orderedColumns = useMemo(
    () => columnOrder.map((key) => COLUMN_DEFS.find((column) => column.key === key)).filter(Boolean),
    [columnOrder],
  );

  const visibleColumns = useMemo(
    () => orderedColumns.filter((column) => visibleColumnKeys.has(column.key)),
    [orderedColumns, visibleColumnKeys],
  );

  const filteredRows = useMemo(() => {
    const searchLower = searchText.trim().toLowerCase();

    if (searchLower) {
      return rows.filter((row) => valueForSearch(row).includes(searchLower));
    }

    return rows;
  }, [rows, searchText]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount]);

  const sortedRows = useMemo(() => {
    const nextRows = [...filteredRows];
    const direction = sortConfig.direction === 'asc' ? 1 : -1;

    nextRows.sort((left, right) => {
      const leftValue = left?.[sortConfig.key];
      const rightValue = right?.[sortConfig.key];

      if (sortConfig.key === 'units') {
        return (toNumber(leftValue) - toNumber(rightValue)) * direction;
      }

      if (typeof leftValue === 'boolean' || typeof rightValue === 'boolean') {
        return (Number(Boolean(leftValue)) - Number(Boolean(rightValue))) * direction;
      }

      return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), undefined, { sensitivity: 'base' }) * direction;
    });

    return nextRows;
  }, [filteredRows, sortConfig]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  const counts = useMemo(() => ({
    rows: rows.length,
    filtered: sortedRows.length,
    visibleColumns: visibleColumns.length,
  }), [rows.length, sortedRows.length, visibleColumns.length]);

  const toggleColumnVisibility = (columnKey) => {
    setVisibleColumnKeys((current) => {
      const next = new Set(current);

      if (next.has(columnKey) && next.size === 1) {
        return next;
      }

      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }

      return next;
    });
  };

  const moveColumn = (columnKey, direction) => {
    setColumnOrder((current) => {
      const index = current.indexOf(columnKey);
      const targetIndex = index + direction;

      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const openRowEditor = (row) => {
    setEditingRowId(row.id);
    setEditDraft({ ...row });
  };

  const closeRowEditor = () => {
    setEditingRowId(null);
    setEditDraft(null);
  };

  const handleEditDraftChange = (columnKey, value) => {
    setEditDraft((current) => ({
      ...current,
      [columnKey]: value,
    }));
  };

  const applyRowEdit = () => {
    if (!editingRowId || !editDraft) return;

    setRows((current) => current.map((row) => {
      if (row.id !== editingRowId) return row;
      return normalizeRow({ ...row, ...editDraft }, 0);
    }));

    setStatusMessage('Row updated.');
    closeRowEditor();
  };

  const toggleLock = (rowId, facloadingId, currentLocked) => {
    const newLocked = !currentLocked;

    // Optimistic local update
    setRows((current) => {
      const next = current.map((r) => (r.id === rowId ? { ...r, locked: newLocked } : r));
      setStatusMessage(newLocked ? 'Row locked.' : 'Row unlocked.');
      return next;
    });

    // Persist to DB when the row has a known DB id
    if (facloadingId != null) {
      updateFacultyLoadingLock(facloadingId, newLocked).catch((err) => {
        console.error('Failed to persist lock to DB:', err);
        // Revert on failure
        setRows((current) =>
          current.map((r) => (r.id === rowId ? { ...r, locked: currentLocked } : r))
        );
        setStatusMessage('Failed to update lock — reverted.');
      });
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Expose a helper to retrieve only unlocked rows for refaculty-loading operations
    window.getFinalizedRowsForRefacultyLoad = () => rows.filter((r) => !r.locked);
    return () => { delete window.getFinalizedRowsForRefacultyLoad; };
  }, [rows]);

  const restoreSourceRows = () => {
    const sourceRows = extractLatestSourceRows();
    setRows(sourceRows);
    setColumnOrder(DEFAULT_COLUMN_ORDER);
    setVisibleColumnKeys(new Set(DEFAULT_COLUMN_ORDER));
    setSortConfig(DEFAULT_SORT);
    setSearchText('');
    setStatusMessage('Latest GA result restored.');
  };

  const exportRows = sortedRows;
  const exportColumns = visibleColumns;

  const handleExport = async (type) => {
    if (!exportRows.length || !exportColumns.length) return;

    // Merge lec_hrs + lab_hrs → "Total Contact Hrs" for all export formats
    const resolvedExportColumns = toExportColumns(exportColumns);
    const filenameBase = `faculty_loading_finalized_${timestampForFileName()}`;

    if (type === 'csv') {
      exportCsv(`${filenameBase}.csv`, exportRows, resolvedExportColumns);
      setStatusMessage('CSV export downloaded.');
      return;
    }

    if (type === 'xlsx') {
      exportXlsx(`${filenameBase}.xlsx`, exportRows, resolvedExportColumns);
      setStatusMessage('Excel export downloaded.');
      return;
    }

    if (type === 'word') {
      await exportWord(`${filenameBase}.docx`, exportRows, resolvedExportColumns);
      setStatusMessage('Word export downloaded.');
      return;
    }

    if (type === 'pdf') {
      exportPdf(`${filenameBase}.pdf`, exportRows, resolvedExportColumns);
      setStatusMessage('PDF export downloaded.');
    }
  };

  const exportFormats = [
    { key: 'pdf', label: 'PDF' },
    { key: 'csv', label: 'CSV' },
    { key: 'word', label: 'Word (.docx)' },
    { key: 'xlsx', label: 'Excel (.xlsx)' },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/50 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <ClipboardList size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-on-surface">Master List Editor</h2>
              <p className="text-xs text-on-surface-variant">Finalize faculty loading — edit, reorder columns, then export.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              <ClipboardList size={10} /> Finalize
            </span>
          </div>
        </div>
      </motion.div>

      <div className="min-w-0 space-y-6">
        <div className="min-w-0 space-y-6">
          <div className="glass-panel rounded-2xl p-6">
            <div className="flex flex-col gap-3 border-b border-white/50 pb-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-xl font-headline-lg font-bold text-on-surface">Finalizing Master List</h3>
                <p className="mt-1 text-sm text-on-surface-variant">Use the action column to edit any row in a popup.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
                <StatChip label="Rows" value={counts.rows} />
                <span className="rounded-full bg-secondary-container/20 px-3 py-1 text-secondary">Filtered rows: {counts.filtered}</span>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-lg">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search rows..."
                  className="w-full rounded-lg border border-white/30 bg-white/60 py-3 pl-10 pr-10 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/70 focus:border-primary focus:bg-white"
                />
                {searchText ? (
                  <button
                    type="button"
                    onClick={() => setSearchText('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors hover:text-on-surface"
                    aria-label="Clear search"
                  >
                    <X size={18} />
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={restoreSourceRows}
                  className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-4 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-white"
                >
                  <RefreshCcw size={16} />
                  Reload source
                </button>
                <button
                  type="button"
                  onClick={() => setShowColumnManager(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-4 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-white"
                >
                  <Eye size={16} />
                  Columns
                </button>
                <button
                  type="button"
                  onClick={() => setShowExportPopup(true)}
                  disabled={!exportRows.length || !exportColumns.length}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FileDown size={16} />
                  Export
                </button>
              </div>
            </div>

            {statusMessage ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-800">
                {statusMessage}
              </div>
            ) : null}

            {sortedRows.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-outline-variant/60 bg-white/60 p-6 text-sm text-on-surface-variant">
                No rows match the current search. Clear the search or reload the source list.
              </div>
            ) : (
                      <>
                      <div className="mt-4 mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm text-on-surface-variant">Showing {Math.min(sortedRows.length, pageSize)} of {sortedRows.length} rows</div>
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-on-surface-variant">Rows per page</label>
                          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-md border border-outline-variant bg-white px-2 py-1 text-sm">
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                          <button type="button" disabled={page === 1} onClick={() => setPage(1)} className="rounded px-2 py-1 text-sm border border-outline-variant">First</button>
                          <button type="button" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded px-2 py-1 text-sm border border-outline-variant">Prev</button>
                          <div className="px-2 text-sm">Page {page} / {pageCount}</div>
                          <button type="button" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded px-2 py-1 text-sm border border-outline-variant">Next</button>
                          <button type="button" disabled={page >= pageCount} onClick={() => setPage(pageCount)} className="rounded px-2 py-1 text-sm border border-outline-variant">Last</button>
                        </div>
                      </div>
                      <div className="mt-4 overflow-hidden rounded-2xl border border-white/60 bg-white/80">
                <div className="max-h-[calc(100vh-26rem)] overflow-auto">
                  <table className="min-w-full w-full text-left text-xs">
                    <thead className="sticky top-0 z-20 border-b border-white bg-white">
                      <tr>
                        {visibleColumns.map((column) => (
                          <th key={column.key} className="px-3 py-3 text-left whitespace-nowrap" style={{ minWidth: COLUMN_MIN_WIDTHS[column.key] || '10rem' }}>
                            <button
                              type="button"
                              onClick={() => setSortConfig((current) => ({
                                key: column.key,
                                direction: current.key === column.key && current.direction === 'asc' ? 'desc' : 'asc',
                              }))}
                              className={`flex items-center gap-1 text-xs font-bold uppercase tracking-[0.28em] transition-colors ${sortConfig.key === column.key ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'}`}
                            >
                              <span>{column.label}</span>
                              <ArrowUpDown size={10} />
                            </button>
                          </th>
                        ))}
                        <th className="px-3 py-3 text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70 whitespace-nowrap">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {paginatedRows.map((row, idx) => (
                        <tr key={row.id} className={`transition-colors ${idx % 2 === 0 ? 'bg-white/60 hover:bg-white/40' : 'hover:bg-white/40'}`}>
                          {visibleColumns.map((column) => (
                            <td key={`${row.id}-${column.key}`} className="px-3 py-2 whitespace-nowrap truncate" style={{ minWidth: COLUMN_MIN_WIDTHS[column.key] || '10rem' }}>
                              <span className="text-xs text-on-surface">{valueForDisplay(row, column.key) || '—'}</span>
                            </td>
                          ))}
                          <td className="px-3 py-2 whitespace-nowrap">
                            {(() => {
                              const isAttention = ['unassigned', 'needs_attention'].includes(String(row.load_status ?? '').toLowerCase());
                              const editBtnClass = `inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${isAttention ? 'bg-primary text-on-primary shadow-lg' : 'border border-outline-variant bg-white/80 text-on-surface hover:bg-white'}`;
                              const lockBtnClass = `inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${row.locked ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100' : 'border border-outline-variant bg-white/80 text-on-surface hover:bg-white'}`;

                              return (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleLock(row.id, row.facloading_id, row.locked)}
                                    className={lockBtnClass}
                                    aria-label={row.locked ? 'Unlock row' : 'Lock row'}
                                  >
                                    {row.locked ? <Unlock size={11} /> : <Lock size={11} />}
                                    {row.locked ? 'Unlock' : 'Lock'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => openRowEditor(row)}
                                    className={editBtnClass}
                                  >
                                    <Edit3 size={11} />
                                    Edit
                                  </button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
               </div>
              </>
            )}
          </div>
        </div>

        
      </div>

      {showColumnManager ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-lg font-bold text-on-surface">Column Manager</h4>
                <p className="mt-1 text-sm text-on-surface-variant">Choose columns for list and export.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowColumnManager(false)}
                className="rounded-lg border border-outline-variant bg-white p-1.5 text-on-surface-variant transition-colors hover:text-on-surface"
                aria-label="Close column manager"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {orderedColumns.map((column, index) => {
                const visible = visibleColumnKeys.has(column.key);
                return (
                  <div
                    key={column.key}
                    className={`rounded-xl border p-3 ${visible ? 'border-white/60 bg-white/80' : 'border-dashed border-outline-variant/60 bg-white/50'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-on-surface">{column.label}</p>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">{column.key}</p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-on-surface-variant">
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => toggleColumnVisibility(column.key)}
                          className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                        />
                        {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      </label>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveColumn(column.key, -1)}
                        disabled={index === 0}
                        className="inline-flex items-center gap-1 rounded-lg border border-outline-variant bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <ArrowUp size={12} />
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveColumn(column.key, 1)}
                        disabled={index === orderedColumns.length - 1}
                        className="inline-flex items-center gap-1 rounded-lg border border-outline-variant bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <ArrowDown size={12} />
                        Down
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {showExportPopup ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/60 bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-lg font-bold text-on-surface">Choose Export Format</h4>
                <p className="mt-1 text-sm text-on-surface-variant">Select one format to download the current filtered list.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportPopup(false)}
                className="rounded-lg border border-outline-variant bg-white p-1.5 text-on-surface-variant transition-colors hover:text-on-surface"
                aria-label="Close export popup"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {exportFormats.map((format) => (
                <button
                  key={format.key}
                  type="button"
                  onClick={async () => {
                    await handleExport(format.key);
                    setShowExportPopup(false);
                  }}
                  className="w-full rounded-xl border border-outline-variant bg-white/90 px-4 py-3 text-left text-sm font-semibold text-on-surface transition-colors hover:bg-primary-container/15"
                >
                  {format.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {editingRowId && editDraft ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-white/60 bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-lg font-bold text-on-surface">Edit Row</h4>
                <p className="mt-1 text-sm text-on-surface-variant">Update the selected row fields then apply changes.</p>
              </div>
              <button
                type="button"
                onClick={closeRowEditor}
                className="rounded-lg border border-outline-variant bg-white p-1.5 text-on-surface-variant transition-colors hover:text-on-surface"
                aria-label="Close edit modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {orderedColumns.map((column) => (
                <label key={`editor-${column.key}`} className="block text-sm">
                  <span className="mb-1 block font-semibold text-on-surface">{column.label}</span>
                  {column.type === 'boolean' ? (
                    <select
                      value={editDraft[column.key] ? 'yes' : 'no'}
                      onChange={(event) => handleEditDraftChange(column.key, event.target.value === 'yes')}
                      className="w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  ) : (
                    <input
                      type={column.type === 'number' ? 'number' : 'text'}
                      value={editDraft[column.key] ?? ''}
                      onChange={(event) => handleEditDraftChange(column.key, event.target.value)}
                      className="w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                    />
                  )}
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeRowEditor}
                className="rounded-xl border border-outline-variant bg-white px-4 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyRowEdit}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-colors hover:bg-primary/90"
              >
                Apply Edit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
