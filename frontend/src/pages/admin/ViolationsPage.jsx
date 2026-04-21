import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { SuccessBanner } from '../../components/common/SuccessBanner.jsx';
import AppealModal from '../../components/admin/AppealModal.jsx';
import AppealList from '../../components/common/AppealList.jsx';
import { apiRequest } from '../../services/api.js';
import { formatDate } from '../../utils/formatDate.js';
import { optionalText } from '../../utils/optionalText.js';

const PAGE_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_EVIDENCE_FILES = 3;

const STATUS_FLOW = ['pending', 'appealed', 'resolved'];
const KNOWN_STATUS_OPTIONS = [
  { code: 'pending', label: 'Pending' },
  { code: 'appealed', label: 'Appealed' },
  { code: 'resolved', label: 'Resolved' },
  { code: 'in_progress', label: 'In Progress' },
  { code: 'dismissed', label: 'Dismissed' }
];

const DEFAULT_FORM = {
  studentQuery: '',
  studentId: '',
  studentName: '',
  studentLrn: '',
  gradeSection: '',
  strand: '',
  incidentDate: '',
  offenseCategory: '',
  offenseId: '',
  incidentNotes: '',
  sanctionId: '',
  remarks: ''
};

const SUGGESTED_SANCTION_VALUE = '__suggested_sanction__';

function toStatusCode(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toStatusLabel(statusCode, fallbackLabel = null) {
  const fallback = optionalText(fallbackLabel);
  if (fallback) return fallback;

  const normalized = toStatusCode(statusCode);
  const known = KNOWN_STATUS_OPTIONS.find((entry) => entry.code === normalized);
  if (known) return known.label;

  if (!normalized) return 'Pending';

  return normalized
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function normalizeStatusOption(row) {
  const code = toStatusCode(row?.code || row?.statusCode || row?.label);
  if (!code) return null;

  return {
    id: Number.isFinite(Number(row?.id)) ? Number(row.id) : null,
    code,
    label: optionalText(row?.label) || toStatusLabel(code)
  };
}

function getStatusBadgeClass(statusCode) {
  const normalized = toStatusCode(statusCode);
  if (normalized === 'resolved') {
    return 'border border-emerald-200 bg-emerald-100 text-emerald-800';
  }
  if (normalized === 'appealed') {
    return 'border border-sky-200 bg-sky-100 text-sky-800';
  }
  if (normalized === 'dismissed') {
    return 'border border-slate-300 bg-slate-200 text-slate-700';
  }
  if (normalized === 'in_progress') {
    return 'border border-indigo-200 bg-indigo-100 text-indigo-800';
  }
  return 'border border-amber-200 bg-amber-100 text-amber-800';
}

function getNextStatusCode(currentStatusCode) {
  const normalized = toStatusCode(currentStatusCode);
  const currentIndex = STATUS_FLOW.indexOf(normalized);
  if (currentIndex < 0) {
    return STATUS_FLOW[0];
  }

  return STATUS_FLOW[(currentIndex + 1) % STATUS_FLOW.length];
}

function formatDateInput(value) {
  const normalized = optionalText(value);
  if (!normalized) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getGradeSectionLabel(gradeLevel, sectionName) {
  const grade = optionalText(gradeLevel);
  const section = optionalText(sectionName);
  if (grade && section && section.toLowerCase() !== 'unassigned') {
    return `${grade}-${section}`;
  }
  if (grade) return String(grade);
  if (section && section.toLowerCase() !== 'unassigned') return section;
  return '';
}

function getOffenseCategory(offense) {
  return optionalText(offense?.category) || 'Uncategorized';
}

function normalizeStudentOption(row) {
  const fullName = optionalText(row?.fullName)
    || optionalText(row?.full_name)
    || [row?.firstName, row?.middleName, row?.lastName].filter(Boolean).join(' ').trim()
    || [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ').trim()
    || 'Unknown Student';

  return {
    id: row?.id || '',
    fullName,
    lrn: optionalText(row?.lrn) || '',
    gradeLevel: row?.gradeLevel ?? row?.grade_level ?? null,
    sectionName: optionalText(row?.sectionName ?? row?.section_name ?? '') || '',
    strand: optionalText(row?.strand) || ''
  };
}

function buildStudentLookupLabel(student) {
  return student.lrn
    ? `${student.fullName} (${student.lrn})`
    : student.fullName;
}

function lookupCodeToLabel(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return '';

  return normalized
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function summarizeSanctionActions(actions) {
  const labels = (Array.isArray(actions) ? actions : [])
    .map((entry) => lookupCodeToLabel(entry?.code) || optionalText(entry?.description) || '')
    .filter(Boolean);

  return labels.length
    ? labels.join(' + ')
    : 'No configured sanction action for this offense level.';
}

function normalizeViolationRow(row) {
  const statusCode = toStatusCode(row?.statusCode || row?.statusLabel || 'pending');
  return {
    ...row,
    studentLrn: optionalText(row?.studentLrn || row?.student_lrn) || '',
    offenseId: row?.offenseId !== undefined && row?.offenseId !== null
      ? Number.parseInt(String(row.offenseId), 10)
      : null,
    sanctionId: row?.sanctionId !== undefined && row?.sanctionId !== null
      ? Number.parseInt(String(row.sanctionId), 10)
      : null,
    statusCode,
    statusLabel: toStatusLabel(statusCode, row?.statusLabel),
    gradeSection: optionalText(row?.gradeSection) || getGradeSectionLabel(row?.gradeLevel, row?.sectionName),
    strand: optionalText(row?.strand) || '',
    incidentNotes: optionalText(row?.incidentNotes) || '',
    remarks: optionalText(row?.remarks) || ''
  };
}

function parseEvidenceFiles(evidence) {
  const files = Array.isArray(evidence?.files) ? evidence.files : [];
  return files
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_FILES);
}

function csvEscape(value) {
  const normalized = String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function downloadCsvFile(filename, content) {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function compressImageToDataUrl(file, maxEdge = 1280, quality = 0.85) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  await image.decode();

  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(objectUrl);

  return canvas.toDataURL('image/jpeg', quality);
}

function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  noOptionsText = 'No options found',
  disabled = false
}) {
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const selectedOption = useMemo(() => {
    const normalizedValue = String(value ?? '');
    return options.find((option) => String(option.value) === normalizedValue) || null;
  }, [options, value]);

  const filteredOptions = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return options;

    return options.filter((option) => {
      const haystack = `${option.label || ''} ${option.searchText || ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [options, searchTerm]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    setSearchTerm('');
    setHighlightedIndex(-1);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleOutsidePointer = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      closePanel();
    };

    window.addEventListener('pointerdown', handleOutsidePointer);
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer);
    };
  }, [closePanel, isOpen]);

  const displayValue = isOpen
    ? searchTerm
    : selectedOption?.label || '';

  const selectOption = (option) => {
    onChange(String(option.value));
    closePanel();
  };

  const onInputKeyDown = (event) => {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(true);
      setHighlightedIndex((previous) => {
        const maxIndex = filteredOptions.length - 1;
        if (maxIndex < 0) return -1;
        return Math.min(maxIndex, previous + 1);
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(true);
      setHighlightedIndex((previous) => {
        const maxIndex = filteredOptions.length - 1;
        if (maxIndex < 0) return -1;
        if (previous <= 0) return 0;
        return previous - 1;
      });
      return;
    }

    if (event.key === 'Enter' && isOpen) {
      if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        event.preventDefault();
        event.stopPropagation();
        selectOption(filteredOptions[highlightedIndex]);
      }
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <input
        value={displayValue}
        onFocus={() => setIsOpen(true)}
        onClick={() => setIsOpen(true)}
        onChange={(event) => {
          setSearchTerm(event.target.value);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={onInputKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-10 text-sm outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closePanel();
            return;
          }

          setIsOpen(true);
        }}
        className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={isOpen ? 'Collapse options' : 'Expand options'}
      >
        <svg viewBox="0 0 20 20" className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`} fill="currentColor" aria-hidden="true">
          <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.18l3.71-3.95a.75.75 0 1 1 1.1 1.02l-4.25 4.53a.75.75 0 0 1-1.1 0L5.21 8.25a.75.75 0 0 1 .02-1.04Z" />
        </svg>
      </button>

      {isOpen ? (
        <div className="violation-combobox-panel absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-56 overflow-y-auto">
            {filteredOptions.length ? filteredOptions.map((option, index) => {
              const isActive = index === highlightedIndex;
              return (
                <button
                  key={`${option.value}`}
                  type="button"
                  className={`violation-combobox-option block w-full border-b border-slate-100 px-3 py-2 text-left text-sm leading-5 text-slate-700 transition last:border-b-0 ${isActive ? 'violation-combobox-option--active' : ''}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  {option.label}
                </button>
              );
            }) : (
              <p className="px-3 py-2 text-sm text-slate-500">{noOptionsText}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Modal({ isOpen, title, onClose, children, maxWidth = 'max-w-5xl', bodyClassName = '' }) {
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="violation-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm sm:p-6" onClick={onClose} role="presentation">
      <div
        className={`violation-modal-panel mx-auto w-full ${maxWidth} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="violation-modal-header flex items-center justify-between bg-gradient-to-r from-teal-700 to-cyan-600 px-5 py-3 text-white">
          <h3 className="text-2xl font-display leading-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="violation-modal-close-btn rounded-md px-2 py-1 text-xl font-bold transition hover:bg-white/20"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className={`violation-modal-body max-h-[80vh] overflow-y-auto px-5 py-4 ${bodyClassName}`.trim()}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

function StatusBadge({ statusCode, statusLabel }) {
  return (
    <span className={`inline-flex min-w-[84px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(statusCode)}`}>
      {toStatusLabel(statusCode, statusLabel)}
    </span>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function CycleStatusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.2" />
      <path d="M21 3v6h-6" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2" />
      <path d="M3 21v-6h6" />
    </svg>
  );
}

function AppealIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function ViolationsPage() {
  const [violations, setViolations] = useState([]);
  const [offenses, setOffenses] = useState([]);
  const [sanctions, setSanctions] = useState([]);
  const [sections, setSections] = useState([]);
  const [violationStatuses, setViolationStatuses] = useState(KNOWN_STATUS_OPTIONS);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [loadingViolations, setLoadingViolations] = useState(false);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isAppealModalOpen, setIsAppealModalOpen] = useState(false);
  const [appealViolation, setAppealViolation] = useState(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    statusCode: '',
    gradeLevel: '',
    sectionName: '',
    strand: ''
  });

  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [sanctionDecisionPreview, setSanctionDecisionPreview] = useState(null);
  const [suggestedSanction, setSuggestedSanction] = useState(null);
  const [actionsByLevel, setActionsByLevel] = useState(null);
  const [sanctionLevelMap, setSanctionLevelMap] = useState({});
  const [isSanctionPreviewLoading, setIsSanctionPreviewLoading] = useState(false);
  const [sanctionPreviewError, setSanctionPreviewError] = useState('');
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingViolationId, setEditingViolationId] = useState('');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formEvidence, setFormEvidence] = useState([]);
  const [isEvidenceDragActive, setIsEvidenceDragActive] = useState(false);

  const [studentSuggestions, setStudentSuggestions] = useState([]);
  const [isStudentLookupLoading, setIsStudentLookupLoading] = useState(false);

  const [isFormHistoryOpen, setIsFormHistoryOpen] = useState(false);
  const [formPreviousOffenses, setFormPreviousOffenses] = useState([]);
  const [isFormPreviousLoading, setIsFormPreviousLoading] = useState(false);
  const [formPreviousError, setFormPreviousError] = useState('');
  

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailViolation, setDetailViolation] = useState(null);
  const [detailHistory, setDetailHistory] = useState([]);
  const [detailHistoryError, setDetailHistoryError] = useState('');
  const [isDetailHistoryLoading, setIsDetailHistoryLoading] = useState(false);
  const [detailAppeals, setDetailAppeals] = useState([]);
  const [detailAppealsError, setDetailAppealsError] = useState('');
  const [isDetailAppealsLoading, setIsDetailAppealsLoading] = useState(false);
  const [imagePreviewSrc, setImagePreviewSrc] = useState('');

  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const fileInputRef = useRef(null);
  const formStudentInputRef = useRef(null);
  const violationsRequestSequenceRef = useRef(0);
  const studentLookupSequenceRef = useRef(0);
  const detailRequestSequenceRef = useRef(0);
  const sanctionPreviewSequenceRef = useRef(0);

  const tableSummary = useMemo(() => {
    if (!totalItems) return 'Showing 0 of 0';
    const start = (page - 1) * PAGE_LIMIT + 1;
    const end = Math.min(page * PAGE_LIMIT, totalItems);
    return `Showing ${start}-${end} of ${totalItems}`;
  }, [page, totalItems]);

  const pageWindow = useMemo(() => {
    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = start + windowSize - 1;

    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - windowSize + 1);
    }

    const pages = [];
    for (let cursor = start; cursor <= end; cursor += 1) {
      pages.push(cursor);
    }

    return pages;
  }, [page, totalPages]);

  const offenseCategories = useMemo(() => {
    const values = new Set(offenses.map((offense) => getOffenseCategory(offense)));
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [offenses]);

  const offenseOptionsForForm = useMemo(() => {
    const selectedCategory = optionalText(form.offenseCategory);
    return offenses
      .filter((offense) => !selectedCategory || getOffenseCategory(offense) === selectedCategory)
      .sort((left, right) => {
        const leftCode = optionalText(left.code) || '';
        const rightCode = optionalText(right.code) || '';
        if (leftCode !== rightCode) {
          return leftCode.localeCompare(rightCode);
        }

        const leftDescription = optionalText(left.description) || '';
        const rightDescription = optionalText(right.description) || '';
        return leftDescription.localeCompare(rightDescription);
      });
  }, [form.offenseCategory, offenses]);

  const offenseDescriptionOptions = useMemo(() => {
    const list = Array.isArray(offenseOptionsForForm) ? offenseOptionsForForm : [];
    return list
      .map((offense) => {
        const id = offense?.id ?? offense?.offenseId ?? null;
        const value = id ? String(id) : optionalText(offense?.code) || '';
        const label = optionalText(offense?.description) || optionalText(offense?.label) || lookupCodeToLabel(offense?.code);
        return { value, label };
      })
      .filter((opt) => optionalText(opt.value));
  }, [offenseOptionsForForm]);


  const gradeOptions = useMemo(() => {
    const values = sections
      .map((section) => Number.parseInt(String(section.gradeLevel ?? ''), 10))
      .filter((value) => Number.isFinite(value) && value > 0);

    return [...new Set(values)].sort((left, right) => left - right);
  }, [sections]);

  const sectionOptions = useMemo(() => {
    const selectedGrade = optionalText(filters.gradeLevel);
    const scoped = sections.filter((section) => {
      if (!selectedGrade) return true;
      return String(section.gradeLevel ?? '') === selectedGrade;
    });

    const values = scoped
      .map((section) => optionalText(section.sectionName))
      .filter(Boolean);

    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
  }, [filters.gradeLevel, sections]);

  const strandOptions = useMemo(() => {
    const selectedGrade = optionalText(filters.gradeLevel);
    const selectedSection = optionalText(filters.sectionName);

    let scoped = sections;
    if (selectedGrade) {
      scoped = scoped.filter((section) => String(section.gradeLevel ?? '') === selectedGrade);
    }
    if (selectedSection) {
      scoped = scoped.filter((section) => optionalText(section.sectionName) === selectedSection);
    }

    const values = scoped
      .map((section) => optionalText(section.strand))
      .filter(Boolean);

    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
  }, [filters.gradeLevel, filters.sectionName, sections]);

  const statusFilterOptions = useMemo(() => {
    const values = new Map(
      violationStatuses.map((entry) => [toStatusCode(entry.code), optionalText(entry.label) || toStatusLabel(entry.code)])
    );

    violations.forEach((row) => {
      const statusCode = toStatusCode(row.statusCode);
      if (!statusCode) return;
      values.set(statusCode, toStatusLabel(statusCode, row.statusLabel));
    });

    return Array.from(values.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [violationStatuses, violations]);

  const offenseTotalsByStudent = useMemo(() => {
    const index = new Map();
    violations.forEach((row) => {
      const studentId = String(row.studentId || '');
      if (!studentId) return;
      index.set(studentId, (index.get(studentId) || 0) + 1);
    });
    return index;
  }, [violations]);

  const isSearchPending = searchInput.trim() !== searchTerm;
  const hasActiveFilters = useMemo(() => {
    return Boolean(
      optionalText(searchTerm)
      || optionalText(filters.fromDate)
      || optionalText(filters.toDate)
      || optionalText(filters.statusCode)
      || optionalText(filters.gradeLevel)
      || optionalText(filters.sectionName)
      || optionalText(filters.strand)
    );
  }, [filters.fromDate, filters.gradeLevel, filters.sectionName, filters.statusCode, filters.strand, filters.toDate, searchTerm]);

  const buildViolationsQueryParams = useCallback((pageValue, limitValue) => {
    const params = new URLSearchParams();
    params.set('page', String(pageValue));
    params.set('limit', String(limitValue));
    params.set('active', 'true');

    if (optionalText(searchTerm)) params.set('q', searchTerm.trim());
    if (optionalText(filters.fromDate)) params.set('fromDate', filters.fromDate.trim());
    if (optionalText(filters.toDate)) params.set('toDate', filters.toDate.trim());
    if (optionalText(filters.statusCode)) params.set('statusCode', toStatusCode(filters.statusCode));
    if (optionalText(filters.gradeLevel)) params.set('gradeLevel', filters.gradeLevel.trim());
    if (optionalText(filters.sectionName)) params.set('sectionName', filters.sectionName.trim());
    if (optionalText(filters.strand)) params.set('strand', filters.strand.trim());

    return params;
  }, [filters.fromDate, filters.gradeLevel, filters.sectionName, filters.statusCode, filters.strand, filters.toDate, searchTerm]);

  const fetchViolations = useCallback(async () => {
    const requestSequence = violationsRequestSequenceRef.current + 1;
    violationsRequestSequenceRef.current = requestSequence;

    try {
      setLoadingViolations(true);
      setError('');

      const params = buildViolationsQueryParams(page, PAGE_LIMIT);
      const payload = await apiRequest(`/violations?${params.toString()}`);
      if (requestSequence !== violationsRequestSequenceRef.current) return;

      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

      setViolations(rows.map(normalizeViolationRow));
      setTotalItems(Number(payload?.totalItems) || 0);
      setTotalPages(Math.max(1, Number(payload?.totalPages) || 1));
    } catch (loadError) {
      if (requestSequence !== violationsRequestSequenceRef.current) return;

      setError(loadError.message || 'Failed to load violations');
      setViolations([]);
      setTotalItems(0);
      setTotalPages(1);
    } finally {
      if (requestSequence === violationsRequestSequenceRef.current) {
        setLoadingViolations(false);
      }
    }
  }, [buildViolationsQueryParams, page]);

  const fetchAllStudentViolations = useCallback(async (studentId) => {
    const normalizedStudentId = optionalText(studentId);
    if (!normalizedStudentId) {
      return [];
    }

    const allRows = [];
    let cursor = 1;
    let maxPages = 1;

    do {
      const params = new URLSearchParams({
        studentId: normalizedStudentId,
        page: String(cursor),
        limit: '200',
        active: 'true'
      });

      const payload = await apiRequest(`/violations?${params.toString()}`);
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

      allRows.push(...rows.map(normalizeViolationRow));
      maxPages = Math.max(1, Number(payload?.totalPages) || 1);
      cursor += 1;
    } while (cursor <= maxPages);

    return allRows;
  }, []);

  const loadFormPreviousOffenses = useCallback(async (studentId, excludeViolationId = null) => {
    const normalizedStudentId = optionalText(studentId);
    if (!normalizedStudentId) {
      setFormPreviousOffenses([]);
      setFormPreviousError('Select a student first to view previous offenses.');
      return;
    }

    try {
      setIsFormPreviousLoading(true);
      setFormPreviousError('');

      const history = await fetchAllStudentViolations(normalizedStudentId);
      const filtered = history
        .filter((entry) => !excludeViolationId || entry.id !== excludeViolationId)
        .sort((left, right) => {
          const leftTime = new Date(left.incidentDate || 0).getTime();
          const rightTime = new Date(right.incidentDate || 0).getTime();
          return rightTime - leftTime;
        });

      setFormPreviousOffenses(filtered);
      if (!filtered.length) {
        setFormPreviousError('No previous offenses found for this student.');
      }
    } catch (loadError) {
      setFormPreviousOffenses([]);
      setFormPreviousError(loadError.message || 'Failed to load previous offenses.');
    } finally {
      setIsFormPreviousLoading(false);
    }
  }, [fetchAllStudentViolations]);

  const resetSanctionPreview = useCallback(() => {
    setSanctionDecisionPreview(null);
    setSuggestedSanction(null);
    setIsSanctionPreviewLoading(false);
    setSanctionPreviewError('');

    setForm((previous) => {
      if (previous.sanctionId !== SUGGESTED_SANCTION_VALUE) {
        return previous;
      }

      return {
        ...previous,
        sanctionId: ''
      };
    });
  }, []);

  const applyStudentToForm = useCallback((student) => {
    if (!student?.id) {
      return;
    }

    setForm((previous) => ({
      ...previous,
      studentQuery: buildStudentLookupLabel(student),
      studentId: student.id,
      studentName: student.fullName,
      studentLrn: student.lrn,
      gradeSection: getGradeSectionLabel(student.gradeLevel, student.sectionName),
      strand: optionalText(student.strand) || '',
      sanctionId: ''
    }));

    resetSanctionPreview();
    setStudentSuggestions([]);
    loadFormPreviousOffenses(student.id, editingViolationId || null);
  }, [editingViolationId, loadFormPreviousOffenses, resetSanctionPreview]);

  const offenseCategoryOptions = useMemo(() => {
    return offenseCategories.map((c) => ({ value: c, label: c }));
  }, [offenseCategories]);

  const sanctionSelectOptions = useMemo(() => {
    // If the sanctions-engine returned actions-per-level, show per-level options (offense 1/2/3)
    if (Array.isArray(actionsByLevel) && actionsByLevel.length) {
      return actionsByLevel.map((entry) => {
        const level = Number.parseInt(String(entry.level || ''), 10) || 1;
        const projectionLabel = optionalText(entry.projection?.label) || summarizeSanctionActions(entry.actions || []);
        const isSuggested = sanctionDecisionPreview && Number.parseInt(String(sanctionDecisionPreview.offenseLevel || ''), 10) === level;
        return {
          value: `__level_${level}`,
          label: `Offense ${level}: ${projectionLabel}${isSuggested ? ' (suggested)' : ''}`
        };
      });
    }

    // Fallback: show canonical sanctions from backend, with suggested sanction on top
    const sanctionMap = new Map();
    (Array.isArray(sanctions) ? sanctions : []).forEach((sanction) => {
      const code = String(sanction?.code ?? '').toUpperCase();
      const label = optionalText(sanction?.label);
      const id = sanction?.id;
      if (code && label) {
        sanctionMap.set(code, {
          value: id ? String(id) : code,
          label
        });
      }
    });

    const suggestedLabel = optionalText(suggestedSanction?.label);
    const suggestedCode = String(suggestedSanction?.code ?? '').toUpperCase();
    let options = Array.from(sanctionMap.values());

    if (suggestedLabel) {
      const matchIdx = options.findIndex(
        (entry) =>
          (suggestedCode && String(entry.value).toUpperCase() === suggestedCode) ||
          entry.label.toLowerCase() === suggestedLabel.toLowerCase()
      );
      if (matchIdx !== -1) {
        const [match] = options.splice(matchIdx, 1);
        options.unshift({ ...match, label: `${match.label} (suggested)` });
      } else {
        options.unshift({ value: suggestedCode || SUGGESTED_SANCTION_VALUE, label: `${suggestedLabel} (suggested)` });
      }
    }

    return options;
  }, [sanctions, suggestedSanction, actionsByLevel, sanctionDecisionPreview]);

  const selectedLevelMapEntry = sanctionLevelMap && sanctionLevelMap[optionalText(form.sanctionId) || ''] ? sanctionLevelMap[optionalText(form.sanctionId) || ''] : null;

  const closeDetailModal = useCallback(() => {
    setIsDetailModalOpen(false);
    setDetailViolation(null);
    setDetailHistory([]);
    setIsDetailHistoryLoading(false);
    setDetailHistoryError('');
  }, []);

  const closeDeleteModal = useCallback(() => {
    if (deletingId) return;
    setIsDeleteModalOpen(false);
    setDeleteCandidate(null);
  }, [deletingId]);

  const closeFormModal = useCallback(() => {
    if (isSubmittingForm) return;
    setIsFormModalOpen(false);
    setEditingViolationId('');
    setForm(DEFAULT_FORM);
    setFormEvidence([]);
    setFormPreviousOffenses([]);
    setFormPreviousError('');
    resetSanctionPreview();
  }, [isSubmittingForm, resetSanctionPreview]);

  const openCreateModal = useCallback(() => {
    setEditingViolationId('');
    setForm(DEFAULT_FORM);
    setFormEvidence([]);
    setFormPreviousOffenses([]);
    setFormPreviousError('');
    resetSanctionPreview();
    setIsFormModalOpen(true);
  }, [resetSanctionPreview]);

  const openEditModal = useCallback((violation) => {
    if (!violation || !violation.id) return;

    setEditingViolationId(violation.id);
    setForm({
      studentQuery: buildStudentLookupLabel({ fullName: optionalText(violation.studentName) || '', lrn: optionalText(violation.studentLrn) || '' }),
      studentId: violation.studentId || '',
      studentName: violation.studentName || '',
      studentLrn: optionalText(violation.studentLrn) || '',
      gradeSection: optionalText(violation.gradeSection) || '',
      strand: optionalText(violation.strand) || '',
      incidentDate: formatDateInput(violation.incidentDate) || '',
      offenseCategory: optionalText(violation.offenseCategory) || '',
      offenseId: violation.offenseId || '',
      incidentNotes: optionalText(violation.incidentNotes) || '',
      sanctionId: violation.sanctionId ? String(violation.sanctionId) : (optionalText(violation.sanctionLabel) ? SUGGESTED_SANCTION_VALUE : ''),
      remarks: optionalText(violation.remarks) || ''
    });

    setFormEvidence(Array.isArray(parseEvidenceFiles(violation.evidence)) ? parseEvidenceFiles(violation.evidence) : []);
    resetSanctionPreview();
    loadFormPreviousOffenses(violation.studentId, violation.id);
    setIsFormModalOpen(true);
  }, [loadFormPreviousOffenses, resetSanctionPreview]);

  const fetchAllFilteredViolations = useCallback(async () => {
    const allRows = [];
    let cursor = 1;
    let maxPages = 1;

    do {
      const params = buildViolationsQueryParams(cursor, 200);
      const payload = await apiRequest(`/violations?${params.toString()}`);
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

      allRows.push(...rows.map(normalizeViolationRow));
      maxPages = Math.max(1, Number(payload?.totalPages) || 1);
      cursor += 1;
    } while (cursor <= maxPages);

    return allRows;
  }, [buildViolationsQueryParams]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoadingBootstrap(true);
        setError('');

        const [offensesResult, sanctionsResult, sectionsResult, statusesResult] = await Promise.allSettled([
          apiRequest('/offenses'),
          apiRequest('/settings/sanctions'),
          apiRequest('/settings/sections'),
          apiRequest('/violations/statuses')
        ]);

        if (offensesResult.status === 'rejected') throw offensesResult.reason;
        if (sanctionsResult.status === 'rejected') throw sanctionsResult.reason;
        if (sectionsResult.status === 'rejected') throw sectionsResult.reason;

        if (cancelled) return;

        setOffenses(Array.isArray(offensesResult.value) ? offensesResult.value : []);
        setSanctions(Array.isArray(sanctionsResult.value) ? sanctionsResult.value : []);
        setSections(Array.isArray(sectionsResult.value) ? sectionsResult.value : []);

        if (statusesResult.status === 'fulfilled' && Array.isArray(statusesResult.value)) {
          const normalizedStatuses = statusesResult.value
            .map(normalizeStatusOption)
            .filter(Boolean);

          if (normalizedStatuses.length) {
            setViolationStatuses(normalizedStatuses);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load violation page metadata');
        }
      } finally {
        if (!cancelled) {
          setLoadingBootstrap(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchViolations();
  }, [fetchViolations]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextValue = searchInput.trim();
      setSearchTerm((previous) => (previous === nextValue ? previous : nextValue));
      setPage((previous) => (previous === 1 ? previous : 1));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    if (!isFormModalOpen) {
      setStudentSuggestions([]);
      setIsStudentLookupLoading(false);
      return;
    }

    const query = form.studentQuery.trim();
    if (query.length < 2) {
      setStudentSuggestions([]);
      setIsStudentLookupLoading(false);
      return;
    }

    const sequence = studentLookupSequenceRef.current + 1;
    studentLookupSequenceRef.current = sequence;

    const timer = window.setTimeout(async () => {
      try {
        setIsStudentLookupLoading(true);
        const params = new URLSearchParams({
          page: '1',
          limit: '8',
          active: 'true',
          q: query
        });

        const payload = await apiRequest(`/students?${params.toString()}`);
        if (sequence !== studentLookupSequenceRef.current) return;

        const rows = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
            ? payload
            : [];

        setStudentSuggestions(rows.map(normalizeStudentOption));
      } catch {
        if (sequence !== studentLookupSequenceRef.current) return;
        setStudentSuggestions([]);
      } finally {
        if (sequence === studentLookupSequenceRef.current) {
          setIsStudentLookupLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [form.studentQuery, isFormModalOpen]);

  useEffect(() => {
    if (!isFormModalOpen || editingViolationId) {
      resetSanctionPreview();
      return;
    }

    const studentId = optionalText(form.studentId);
    const offenseId = Number.parseInt(String(form.offenseId || ''), 10);

    if (!studentId || !Number.isFinite(offenseId) || offenseId <= 0) {
      resetSanctionPreview();
      return;
    }

    const sequence = sanctionPreviewSequenceRef.current + 1;
    sanctionPreviewSequenceRef.current = sequence;

    const timer = window.setTimeout(async () => {
      try {
        setIsSanctionPreviewLoading(true);
        setSanctionPreviewError('');

        const preview = await apiRequest('/violations/sanctions-preview', {
          method: 'POST',
          body: {
            studentId,
            offenseId
          }
        });

        if (sequence !== sanctionPreviewSequenceRef.current) return;

        const decision = preview?.sanctionDecision || null;
        const suggested = preview?.suggestedSanction || null;
        const byLevel = Array.isArray(preview?.actionsByLevel) ? preview.actionsByLevel : null;

        setSanctionDecisionPreview(decision);
        setSuggestedSanction(suggested);
        setActionsByLevel(byLevel);

        // Build a quick lookup map for level-option -> { id, label }
        if (byLevel) {
          const map = {};
          for (const item of byLevel) {
            const key = `__level_${item.level}`;
            const label = optionalText(item.projection?.label) || summarizeSanctionActions(item.actions || []);
            map[key] = {
              id: (item.existing && item.existing.id) || null,
              label,
              projection: item.projection || null,
              level: item.level
            };
          }
          setSanctionLevelMap(map);

          // default select computed offense level if no explicit selection
          if (!optionalText(form.sanctionId) && decision?.offenseLevel) {
            const defaultKey = `__level_${decision.offenseLevel}`;
            if (map[defaultKey]) {
              setForm((previous) => ({ ...previous, sanctionId: defaultKey }));
            }
          }
        } else if (!optionalText(form.sanctionId) && suggested?.id) {
          setForm((previous) => {
            if (optionalText(previous.sanctionId)) return previous;
            return { ...previous, sanctionId: String(suggested.id) };
          });
        }
      } catch (previewError) {
        if (sequence !== sanctionPreviewSequenceRef.current) return;
        setSanctionDecisionPreview(null);
        setSuggestedSanction(null);
        setSanctionPreviewError(previewError.message || 'Failed to map sanction for the selected violation.');
      } finally {
        if (sequence === sanctionPreviewSequenceRef.current) {
          setIsSanctionPreviewLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [editingViolationId, form.offenseId, form.sanctionId, form.studentId, isFormModalOpen, resetSanctionPreview]);

  useEffect(() => {
    if (!isFormModalOpen) return;
    const timer = window.setTimeout(() => {
      formStudentInputRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [isFormModalOpen]);

  useEffect(() => {
    if (!isFormModalOpen && !isDetailModalOpen && !imagePreviewSrc) {
      return undefined;
    }

    const handleEsc = (event) => {
      if (event.key !== 'Escape') return;

      if (imagePreviewSrc) {
        setImagePreviewSrc('');
        return;
      }

      if (isDetailModalOpen) {
        closeDetailModal();
        return;
      }

      if (isFormModalOpen) {
        closeFormModal();
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [closeDetailModal, closeFormModal, imagePreviewSrc, isDetailModalOpen, isFormModalOpen]);

  const onApplyFilters = () => {
    setSearchTerm(searchInput.trim());
    setPage(1);
  };

  const onResetFilters = () => {
    setSearchInput('');
    setSearchTerm('');
    setFilters({
      fromDate: '',
      toDate: '',
      statusCode: '',
      gradeLevel: '',
      sectionName: '',
      strand: ''
    });
    setPage(1);
  };

  const onChangeFilter = (field, value) => {
    setFilters((previous) => {
      const next = { ...previous, [field]: value };

      if (field === 'gradeLevel') {
        const sectionStillValid = !next.sectionName || sectionOptions.includes(next.sectionName);
        const strandStillValid = !next.strand || strandOptions.includes(next.strand);

        if (!sectionStillValid) next.sectionName = '';
        if (!strandStillValid) next.strand = '';
      }

      if (field === 'sectionName') {
        const strandStillValid = !next.strand || strandOptions.includes(next.strand);
        if (!strandStillValid) next.strand = '';
      }

      return next;
    });

    setPage(1);
  };

  const onChangeForm = (field, value) => {
    if (field === 'offenseCategory' || field === 'offenseId') {
      setError('');
    }

    if (field === 'studentQuery' || field === 'offenseCategory' || field === 'offenseId') {
      resetSanctionPreview();
    }

    setForm((previous) => {
      if (field === 'studentQuery') {
        const normalized = value.trim();
        const selectedLabel = previous.studentName
          ? buildStudentLookupLabel({ fullName: previous.studentName, lrn: previous.studentLrn })
          : '';

        if (normalized && normalized === selectedLabel) {
          return {
            ...previous,
            studentQuery: value
          };
        }

        return {
          ...previous,
          studentQuery: value,
          studentId: '',
          studentName: '',
          studentLrn: '',
          gradeSection: '',
          strand: '',
          sanctionId: ''
        };
      }

      if (field === 'offenseCategory') {
        return {
          ...previous,
          offenseCategory: value,
          offenseId: '',
          sanctionId: ''
        };
      }

      if (field === 'offenseId') {
        return {
          ...previous,
          offenseId: value,
          sanctionId: ''
        };
      }

      return {
        ...previous,
        [field]: value
      };
    });

    if (field === 'studentQuery') {
      setFormPreviousOffenses([]);
      setFormPreviousError('Select a student first to view previous offenses.');
    }
  };

  const onToggleFormHistory = (nextOpen) => {
    setIsFormHistoryOpen(nextOpen);
    if (!nextOpen) return;
    if (!form.studentId) {
      setFormPreviousError('Select a student first to view previous offenses.');
      return;
    }
    loadFormPreviousOffenses(form.studentId, editingViolationId || null);
  };

  const onSubmitForm = async (event) => {
    event.preventDefault();
    if (isSubmittingForm) return;

    const studentId = optionalText(form.studentId);
    const offenseCategory = optionalText(form.offenseCategory);
    const offenseId = Number.parseInt(String(form.offenseId || ''), 10);
    const incidentDate = formatDateInput(form.incidentDate);
    const incidentNotes = optionalText(form.incidentNotes);
    const selectedSanctionValue = optionalText(form.sanctionId);
    const parsedSanctionId = Number.parseInt(String(selectedSanctionValue || ''), 10);

    // Determine if the selected value maps to a computed offense-level option
    let payloadSanctionIdValue = undefined;
    let selectedSuggestedSanctionLabel = null;

    if (selectedSanctionValue && selectedSanctionValue.startsWith('__level_')) {
      const mapEntry = sanctionLevelMap[selectedSanctionValue];
      if (mapEntry) {
        if (mapEntry.id) payloadSanctionIdValue = Number.parseInt(String(mapEntry.id), 10);
        else selectedSuggestedSanctionLabel = mapEntry.label;
      }
    } else if (selectedSanctionValue === SUGGESTED_SANCTION_VALUE) {
      selectedSuggestedSanctionLabel = optionalText(suggestedSanction?.label);
    } else if (Number.isFinite(parsedSanctionId) && parsedSanctionId > 0) {
      payloadSanctionIdValue = parsedSanctionId;
    }

    if (!studentId) {
      setError('Select a student from the lookup list before saving.');
      return;
    }

    if (!offenseCategory) {
      setError('Select a violation category first before choosing a violation description.');
      return;
    }

    if (!Number.isFinite(offenseId) || offenseId <= 0) {
      setError('Select a violation description before saving.');
      return;
    }

    if (!incidentDate) {
      setError('Incident date is required.');
      return;
    }

    if (!incidentNotes) {
      setError('Incident notes are required.');
      return;
    }

    const payload = {
      studentId,
      offenseId,
      incidentDate,
      incidentNotes,
      sanctionId: Number.isFinite(payloadSanctionIdValue) && payloadSanctionIdValue > 0 ? payloadSanctionIdValue : undefined,
      sanctionLabel: selectedSuggestedSanctionLabel || undefined,
      remarks: optionalText(form.remarks),
      evidence: formEvidence.length ? { files: formEvidence } : null
    };

    try {
      setIsSubmittingForm(true);
      setError('');

      if (editingViolationId) {
        await apiRequest(`/violations/${editingViolationId}`, {
          method: 'PATCH',
          body: payload
        });
        setSuccess('Violation updated successfully.');
      } else {
        const created = await apiRequest('/violations/log', {
          method: 'POST',
          body: payload
        });

        const actionSummary = summarizeSanctionActions(created?.sanctionDecision?.actions || []);
        setSuccess(`Violation created successfully. Mapped sanctions: ${actionSummary}`);
      }

      closeFormModal();
      setEditingViolationId('');
      setForm(DEFAULT_FORM);
      setFormEvidence([]);
      setFormPreviousOffenses([]);
      setFormPreviousError('');
      setIsFormHistoryOpen(false);

      if (!editingViolationId && page !== 1) {
        setPage(1);
      } else {
        await fetchViolations();
      }
    } catch (saveError) {
      setError(saveError.message || 'Failed to save violation');
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const onPickEvidenceFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const slotsLeft = MAX_EVIDENCE_FILES - formEvidence.length;
    if (slotsLeft <= 0) {
      setError(`Only up to ${MAX_EVIDENCE_FILES} images are allowed.`);
      return;
    }

    const imageFiles = files.filter((file) => /^image\//i.test(file.type)).slice(0, slotsLeft);
    if (!imageFiles.length) {
      setError('Only image files are supported for evidence upload.');
      return;
    }

    try {
      setError('');
      const converted = [];
      for (const file of imageFiles) {
        // Sequential compression avoids large memory spikes with multiple high-res files.
        const dataUrl = await compressImageToDataUrl(file);
        converted.push(dataUrl);
      }

      setFormEvidence((previous) => [...previous, ...converted].slice(0, MAX_EVIDENCE_FILES));
    } catch {
      setError('Failed to process one or more evidence files.');
    }
  };

  const onRemoveEvidence = (index) => {
    setFormEvidence((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  };

  const onOpenDetail = async (violation) => {
    if (!violation?.id) return;

    setIsDetailModalOpen(true);
    setDetailViolation(violation);
    setDetailHistory([]);
    setDetailHistoryError('');
    setIsDetailHistoryLoading(true);
    setDetailAppeals([]);
    setDetailAppealsError('');
    setIsDetailAppealsLoading(true);

    const sequence = detailRequestSequenceRef.current + 1;
    detailRequestSequenceRef.current = sequence;

    try {
      const [detailPayload, historyPayload, appealsPayload] = await Promise.all([
        apiRequest(`/violations/${violation.id}`),
        fetchAllStudentViolations(violation.studentId),
        apiRequest(`/appeals?violationId=${encodeURIComponent(violation.id)}`)
      ]);

      if (sequence !== detailRequestSequenceRef.current) return;

      const detail = normalizeViolationRow(detailPayload || violation);
      const history = Array.isArray(historyPayload)
        ? historyPayload
            .slice()
            .sort((left, right) => {
              const leftTime = new Date(left.incidentDate || 0).getTime();
              const rightTime = new Date(right.incidentDate || 0).getTime();
              return leftTime - rightTime;
            })
        : [];

      const appealsList = Array.isArray(appealsPayload)
        ? appealsPayload
        : Array.isArray(appealsPayload?.data)
          ? appealsPayload.data
          : [];

      setDetailViolation(detail);
      setDetailHistory(history);
      setDetailAppeals(appealsList);
    } catch (loadError) {
      if (sequence !== detailRequestSequenceRef.current) return;
      const msg = loadError.message || 'Failed to load violation details.';
      setDetailHistoryError(msg);
      setDetailAppealsError(msg);
    } finally {
      if (sequence === detailRequestSequenceRef.current) {
        setIsDetailHistoryLoading(false);
        setIsDetailAppealsLoading(false);
      }
    }
  };

  const onCycleStatus = async (violation) => {
    if (!violation?.id || statusUpdatingId) return;

    const nextStatusCode = getNextStatusCode(violation.statusCode);
    const nextLabel = toStatusLabel(nextStatusCode);
    const confirmed = window.confirm(`Change violation status to ${nextLabel}?`);
    if (!confirmed) return;

    try {
      setStatusUpdatingId(violation.id);
      setError('');

      const updated = normalizeViolationRow(
        await apiRequest(`/violations/${violation.id}/status`, {
          method: 'PATCH',
          body: { statusCode: nextStatusCode }
        })
      );

      setViolations((previous) => previous.map((row) => (row.id === violation.id ? updated : row)));
      setSuccess(`Status updated to ${toStatusLabel(updated.statusCode, updated.statusLabel)}.`);

      if (detailViolation?.id === violation.id) {
        setDetailViolation(updated);
      }
    } catch (updateError) {
      setError(updateError.message || 'Failed to update violation status');
    } finally {
      setStatusUpdatingId('');
    }
  };

  const onDeleteViolation = async (violation) => {
    if (!violation?.id || deletingId) return;

    setDeleteCandidate(violation);
    setIsDeleteModalOpen(true);
  };

  const onConfirmDeleteViolation = async () => {
    if (!deleteCandidate?.id || deletingId) return;

    try {
      setDeletingId(deleteCandidate.id);
      setError('');

      await apiRequest(`/violations/${deleteCandidate.id}`, { method: 'DELETE' });
      setSuccess('Violation deleted successfully.');
      setIsDeleteModalOpen(false);
      setDeleteCandidate(null);

      if (violations.length === 1 && page > 1) {
        setPage((previous) => Math.max(1, previous - 1));
      } else {
        await fetchViolations();
      }

      if (detailViolation?.id === deleteCandidate.id) {
        closeDetailModal();
      }
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete violation');
    } finally {
      setDeletingId('');
    }
  };

  const onExportCsv = async () => {
    try {
      setIsExporting(true);
      setError('');

      const rows = await fetchAllFilteredViolations();
      if (!rows.length) {
        setError('No rows match the current filters.');
        return;
      }

      const metadataLines = [
        ['Violation Report'],
        ['Generated on', new Date().toLocaleString()],
        ['Search', searchTerm || 'None'],
        ['Status', toStatusLabel(filters.statusCode) || 'All'],
        ['Date Range', [filters.fromDate || 'Any', filters.toDate || 'Any'].join(' to ')],
        ['Grade', filters.gradeLevel || 'All'],
        ['Section', filters.sectionName || 'All'],
        ['Program / Strand', filters.strand || 'All'],
        []
      ];

      const headers = [
        'Student Name',
        'LRN',
        'Grade & Section',
        'Program / Strand',
        'Incident Date',
        'Violation Category',
        'Violation Description',
        'Incident Notes',
        'Sanction',
        'Status',
        'Remarks',
        'Recorded Date'
      ];

      const csvRows = rows.map((row) => [
        optionalText(row.studentName) || '-',
        optionalText(row.studentLrn) || '-',
        optionalText(row.gradeSection) || '-',
        optionalText(row.strand) || '-',
        optionalText(formatDate(row.incidentDate)) || '-',
        optionalText(row.offenseCategory) || '-',
        optionalText(row.offenseDescription) || '-',
        optionalText(row.incidentNotes) || '-',
        optionalText(row.sanctionLabel) || '-',
        toStatusLabel(row.statusCode, row.statusLabel),
        optionalText(row.remarks) || '-',
        optionalText(formatDate(row.createdAt)) || '-'
      ]);

      const allLines = [];
      metadataLines.forEach((line) => {
        allLines.push(line.map(csvEscape).join(','));
      });
      allLines.push(headers.map(csvEscape).join(','));
      csvRows.forEach((line) => {
        allLines.push(line.map(csvEscape).join(','));
      });

      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      downloadCsvFile(`violations-report-${stamp}.csv`, allLines.join('\r\n'));
      setSuccess(`Downloaded report with ${rows.length} row(s).`);
    } catch (exportError) {
      setError(exportError.message || 'Failed to export CSV report');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <SectionCard
        title="Violation List"
        description="Modernized violations workflow aligned to SDMS backend while preserving the original admin flow."
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCreateModal}
              className="violations-toolbar-btn violations-toolbar-btn--primary"
            >
              + Add Violation
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              disabled={isExporting || loadingViolations}
              className="violations-toolbar-btn violations-toolbar-btn--secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExporting ? 'Exporting...' : 'Download Report'}
            </button>
          </div>
          <p className="text-sm text-slate-600">{tableSummary}</p>
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[2fr_repeat(6,minmax(0,1fr))]">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Search</span>
            <div className="flex items-center gap-2">
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search student, section, offense, notes"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
              />
              <button
                type="button"
                onClick={onApplyFilters}
                className="violations-filter-apply-btn"
              >
                Apply
              </button>
            </div>
            {isSearchPending ? <span className="mt-1 block text-xs text-slate-500">Searching...</span> : null}
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">From</span>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(event) => onChangeFilter('fromDate', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            />
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">To</span>
            <input
              type="date"
              value={filters.toDate}
              onChange={(event) => onChangeFilter('toDate', event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            />
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Status</span>
            <select
              value={filters.statusCode}
              onChange={(event) => onChangeFilter('statusCode', event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="">All</option>
              {statusFilterOptions.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Grade</span>
            <select
              value={filters.gradeLevel}
              onChange={(event) => onChangeFilter('gradeLevel', event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="">All</option>
              {gradeOptions.map((grade) => (
                <option key={grade} value={String(grade)}>{grade}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Section</span>
            <select
              value={filters.sectionName}
              onChange={(event) => onChangeFilter('sectionName', event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="">All</option>
              {sectionOptions.map((section) => (
                <option key={section} value={section}>{section}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Program / Strand</span>
            <select
              value={filters.strand}
              onChange={(event) => onChangeFilter('strand', event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            >
              <option value="">All</option>
              {strandOptions.map((strand) => (
                <option key={strand} value={strand}>{strand}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={onResetFilters}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset Filters
          </button>
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="student-table-head">
              <tr className="border-b border-slate-200 text-slate-700">
                <th className="w-[12%] px-3 py-2.5"><span className="block leading-5">Student</span><span className="block leading-5">Name</span></th>
                <th className="w-[6%] px-3 py-2.5">Program / Strand</th>
                <th className="w-[8%] px-3 py-2.5"><span className="block leading-5">Grade &amp;</span><span className="block leading-5">Section</span></th>
                <th className="w-[8%] px-3 py-2.5"><span className="block leading-5">Incident</span><span className="block leading-5">Date</span></th>
                <th className="w-[22%] px-3 py-2.5"><span className="block leading-5">Violation</span><span className="block leading-5">Type</span></th>
                <th className="w-[6%] px-3 py-2.5"><span className="block leading-5">Past</span><span className="block leading-5">Offense</span></th>
                <th className="w-[7%] px-3 py-2.5"><span className="block leading-5">Total</span><span className="block leading-5">Offenses</span></th>
                <th className="w-[8%] px-3 py-2.5">Sanction</th>
                <th className="w-[8%] px-3 py-2.5 text-center">Status</th>
                <th className="w-[7%] px-3 py-2.5"><span className="block leading-5">Date</span><span className="block leading-5">Added</span></th>
                <th className="violation-actions-head w-[8rem] whitespace-nowrap px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((row) => {
                const pastOffense = Math.max(0, Number(row.repeatCountAtInsert || 1) - 1);
                const totalOffenses = offenseTotalsByStudent.get(String(row.studentId || '')) || 1;
                const nextStatusCode = getNextStatusCode(row.statusCode);

                return (
                  <tr key={row.id} className="violation-row border-b border-slate-100 transition hover:bg-slate-50/80">
                    <td className="px-3 py-3 align-top">
                      <div className="max-w-[190px] whitespace-normal break-normal leading-6">{row.studentName || '-'}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="max-w-[95px] whitespace-normal break-normal leading-6">{row.strand || '-'}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="max-w-[120px] whitespace-normal break-normal leading-6">{row.gradeSection || '-'}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="whitespace-normal break-normal leading-6">{formatDate(row.incidentDate) || '-'}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="max-w-[340px] whitespace-normal break-words leading-6" title={row.offenseDescription || '-'}>{row.offenseDescription || '-'}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="whitespace-normal break-normal leading-6">{pastOffense || '-'}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="whitespace-normal break-normal leading-6">{totalOffenses}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="max-w-[140px] whitespace-normal break-normal leading-6">{row.sanctionLabel || '-'}</div>
                    </td>
                    <td className="px-3 py-3 align-top text-center">
                      <div className="flex justify-center">
                        <StatusBadge statusCode={row.statusCode} statusLabel={row.statusLabel} />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="whitespace-normal break-normal leading-6">{formatDate(row.createdAt) || '-'}</div>
                    </td>
                    <td className="violation-actions-cell px-3 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenDetail(row)}
                          className="student-action-btn student-action-btn--view"
                          aria-label={`View violation for ${row.studentName || 'student'}`}
                          title="View"
                        >
                          <EyeIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="student-action-btn student-action-btn--edit"
                          aria-label={`Edit violation for ${row.studentName || 'student'}`}
                          title="Edit"
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => onCycleStatus(row)}
                          disabled={statusUpdatingId === row.id}
                          className="violation-status-btn violation-status-btn--icon"
                          aria-label={`Set status to ${toStatusLabel(nextStatusCode)} for ${row.studentName || 'student'}`}
                          title={`Set to ${toStatusLabel(nextStatusCode)}`}
                        >
                          <CycleStatusIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteViolation(row)}
                          disabled={deletingId === row.id}
                          className="student-action-btn student-action-btn--delete disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Delete violation for ${row.studentName || 'student'}`}
                          title="Delete"
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!violations.length ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                    {loadingViolations
                      ? 'Loading violations...'
                      : hasActiveFilters
                        ? 'No violations match the current filters.'
                        : 'No violations found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {violations.map((row) => {
            const pastOffense = Math.max(0, Number(row.repeatCountAtInsert || 1) - 1);
            const totalOffenses = offenseTotalsByStudent.get(String(row.studentId || '')) || 1;
            const nextStatusCode = getNextStatusCode(row.statusCode);

            return (
              <article key={`mobile-${row.id}`} className="violation-mobile-card rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-base font-semibold text-slate-900">{row.studentName || '-'}</h4>
                    <p className="text-xs text-slate-600">{row.gradeSection || '-'} {row.strand ? `| ${row.strand}` : ''}</p>
                  </div>
                  <StatusBadge statusCode={row.statusCode} statusLabel={row.statusLabel} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-slate-700">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident Date</dt>
                    <dd>{formatDate(row.incidentDate) || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date Added</dt>
                    <dd>{formatDate(row.createdAt) || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sanction</dt>
                    <dd className="whitespace-normal break-normal">{row.sanctionLabel || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Offenses</dt>
                    <dd>{pastOffense || '-'} past | {totalOffenses} total</dd>
                  </div>
                </dl>

                <div className="violation-mobile-type mt-2 rounded-lg bg-slate-50 px-2 py-2 text-sm text-slate-700">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Violation Type</span>
                  <p className="mt-1 whitespace-normal break-normal leading-6">{row.offenseDescription || '-'}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenDetail(row)}
                    className="student-action-btn student-action-btn--view"
                    aria-label={`View violation for ${row.studentName || 'student'}`}
                    title="View"
                  >
                    <EyeIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(row)}
                    className="student-action-btn student-action-btn--edit"
                    aria-label={`Edit violation for ${row.studentName || 'student'}`}
                    title="Edit"
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => onCycleStatus(row)}
                    disabled={statusUpdatingId === row.id}
                    className="violation-status-btn violation-status-btn--icon"
                    aria-label={`Set status to ${toStatusLabel(nextStatusCode)} for ${row.studentName || 'student'}`}
                    title={`Set to ${toStatusLabel(nextStatusCode)}`}
                  >
                    <CycleStatusIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteViolation(row)}
                    disabled={deletingId === row.id}
                    className="student-action-btn student-action-btn--delete disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`Delete violation for ${row.studentName || 'student'}`}
                    title="Delete"
                  >
                    <DeleteIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAppealViolation(row); setIsAppealModalOpen(true); }}
                    className="student-action-btn student-action-btn--appeal"
                    aria-label={`Create appeal for ${row.studentName || 'student'}`}
                    title="Create Appeal"
                  >
                    <AppealIcon />
                  </button>
                </div>
              </article>
            );
          })}

          {!violations.length ? (
            <div className="violation-mobile-empty rounded-xl border border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
              {loadingViolations
                ? 'Loading violations...'
                : hasActiveFilters
                  ? 'No violations match the current filters.'
                  : 'No violations found.'}
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">{tableSummary}</p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prev
            </button>

            {pageWindow.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  pageNumber === page
                    ? 'bg-teal-700 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {pageNumber}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

        {loadingBootstrap ? <p className="mt-3 text-sm text-slate-500">Loading offense, sanction, and section references...</p> : null}
      </SectionCard>

      <Modal
        isOpen={isFormModalOpen}
        title={editingViolationId ? 'Edit Violation' : 'Add Violation'}
        onClose={closeFormModal}
      >
        <form onSubmit={onSubmitForm} className="grid gap-3">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block font-semibold text-slate-800">LRN or Student Name Lookup</span>
            <div className="relative">
              <input
                ref={formStudentInputRef}
                value={form.studentQuery}
                onChange={(event) => onChangeForm('studentQuery', event.target.value)}
                placeholder="Type student LRN or name"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                autoComplete="off"
              />

              {isStudentLookupLoading ? (
                <span className="absolute right-3 top-2 text-xs text-slate-500">Searching...</span>
              ) : null}

              {studentSuggestions.length ? (
                <div className="violation-student-suggestions absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {studentSuggestions.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => applyStudentToForm(student)}
                      className="violation-student-suggestion-option block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <div className="font-semibold text-slate-800">{student.fullName}</div>
                      <div className="text-xs text-slate-500">
                        {student.lrn ? `LRN: ${student.lrn}` : 'No LRN'}
                        {' | '}
                        {getGradeSectionLabel(student.gradeLevel, student.sectionName) || 'No grade/section'}
                        {student.strand ? ` | ${student.strand}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">Student Name</span>
              <input
                value={form.studentName}
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
            </label>

            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">LRN</span>
              <input
                value={form.studentLrn}
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
            </label>

            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">Grade &amp; Section</span>
              <input
                value={form.gradeSection}
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
            </label>

            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">Program / Strand</span>
              <input
                value={form.strand}
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              />
            </label>
          </div>

          <details open={isFormHistoryOpen} onToggle={(event) => onToggleFormHistory(event.currentTarget.open)} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer font-semibold text-slate-800">Previous Offenses</summary>
            <div className="mt-2 space-y-2">
              {isFormPreviousLoading ? <p className="text-sm text-slate-600">Loading previous offenses...</p> : null}
              {!isFormPreviousLoading && formPreviousError ? <p className="text-sm text-slate-600">{formPreviousError}</p> : null}

              {!isFormPreviousLoading && !formPreviousError && formPreviousOffenses.length ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                    <div><strong>Student:</strong> {form.studentName || '-'}</div>
                    <div><strong>Grade &amp; Section:</strong> {form.gradeSection || '-'}</div>
                    <div><strong>Total previous cases:</strong> {formPreviousOffenses.length}</div>
                  </div>

                  {formPreviousOffenses.map((entry, index) => (
                    <article key={entry.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                      <h4 className="text-lg font-semibold text-slate-900">Case {index + 1} — {formatDate(entry.incidentDate) || '-'}</h4>
                      <div className="mt-1 border-t border-slate-100 pt-1">
                        <div><strong>Violation Type:</strong> {entry.offenseDescription || '-'}</div>
                        <div><strong>Sanction:</strong> {entry.sanctionLabel || '-'}</div>
                        <div><strong>Recorded On:</strong> {formatDate(entry.createdAt) || '-'}</div>
                        <div className="flex items-center gap-2"><strong>Status:</strong><StatusBadge statusCode={entry.statusCode} statusLabel={entry.statusLabel} /></div>
                        <div><strong>Remarks:</strong> {entry.remarks || '-'}</div>
                      </div>
                    </article>
                  ))}
                </>
              ) : null}
            </div>
          </details>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">Incident Date</span>
              <input
                required
                type="date"
                value={form.incidentDate}
                onChange={(event) => onChangeForm('incidentDate', event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
              />
            </label>

            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">Violation Category</span>
              <SearchableSelect
                value={form.offenseCategory}
                options={offenseCategoryOptions}
                onChange={(nextValue) => onChangeForm('offenseCategory', nextValue)}
                placeholder="Select Category"
                ariaLabel="Violation category"
                noOptionsText="No category matches your search."
              />
            </label>
          </div>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block font-semibold text-slate-800">Violation Description</span>
            <div className="relative">
              <SearchableSelect
                value={form.offenseId}
                options={offenseDescriptionOptions}
                onChange={(nextValue) => onChangeForm('offenseId', nextValue)}
                placeholder={optionalText(form.offenseCategory) ? 'Select Description' : 'Select category first'}
                ariaLabel="Violation description"
                noOptionsText={optionalText(form.offenseCategory)
                  ? 'No violation description matches your search.'
                  : 'Choose a violation category first.'}
                disabled={!optionalText(form.offenseCategory)}
              />
              {!optionalText(form.offenseCategory) ? (
                <button
                  type="button"
                  className="absolute inset-0 z-10 cursor-not-allowed rounded-xl bg-transparent"
                  onClick={() => setError('Please select a violation category first.')}
                  aria-label="Please select a violation category first"
                  title="Please select a violation category first."
                />
              ) : null}
            </div>
            {!optionalText(form.offenseCategory) ? (
              <span className="mt-1 block text-xs text-slate-500">
                Click and select Violation Category first to unlock Violation Description.
              </span>
            ) : null}
          </label>

          <label className="text-sm text-slate-700">
            <span className="mb-1 block font-semibold text-slate-800">Incident Notes</span>
            <textarea
              required
              value={form.incidentNotes}
              onChange={(event) => onChangeForm('incidentNotes', event.target.value)}
              placeholder="Describe the incident details"
              className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">Sanction</span>
              <div className="relative">
                <select
                  value={form.sanctionId}
                  onChange={(event) => onChangeForm('sanctionId', event.target.value)}
                  disabled={!optionalText(form.offenseId)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Select sanction</option>
                  {sanctionSelectOptions.map((sanction) => (
                    <option key={sanction.value} value={sanction.value}>
                      {sanction.label}
                    </option>
                  ))}
                </select>

                {!optionalText(form.offenseId) ? (
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-not-allowed rounded-xl bg-transparent"
                    onClick={() => setError('Please select a violation description first.')}
                    aria-label="Please select a violation description first"
                    title="Please select a violation description first."
                  />
                ) : null}
              </div>
              {isSanctionPreviewLoading ? (
                <span className="mt-1 block text-xs text-slate-500">Mapping sanction based on selected violation...</span>
              ) : null}
              {!isSanctionPreviewLoading && sanctionDecisionPreview ? (
                <span className="mt-1 block text-xs text-sky-700">
                  Offense level {sanctionDecisionPreview.offenseLevel} of {sanctionDecisionPreview.maxOffenseLevel}: {summarizeSanctionActions(sanctionDecisionPreview.actions)}
                </span>
              ) : null}
              {!isSanctionPreviewLoading && sanctionPreviewError ? (
                <span className="mt-1 block text-xs text-rose-700">{sanctionPreviewError}</span>
              ) : null}

              {!optionalText(form.offenseId) ? (
                <span className="mt-1 block text-xs text-slate-500">
                  Select a violation description first to unlock Sanction selection.
                </span>
              ) : null}
            </label>

            <label className="text-sm text-slate-700">
              <span className="mb-1 block font-semibold text-slate-800">Remarks</span>
              <input
                value={form.remarks}
                onChange={(event) => onChangeForm('remarks', event.target.value)}
                placeholder="Teacher in charge, students involved, etc."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
              />
            </label>
          </div>

          <div>
            <p className="mb-1 block text-sm font-semibold text-slate-800">Evidence (up to 3 images)</p>
            <div
              className={`rounded-xl border-2 border-dashed p-4 text-center transition ${isEvidenceDragActive ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-50'}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsEvidenceDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsEvidenceDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsEvidenceDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsEvidenceDragActive(false);
                onPickEvidenceFiles(event.dataTransfer?.files);
              }}
            >
              <p className="text-sm text-slate-600">Drag and drop images here, or choose files.</p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
                >
                  Choose file(s)
                </button>
                {formEvidence.length ? (
                  <button
                    type="button"
                    onClick={() => setFormEvidence([])}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  onPickEvidenceFiles(event.target.files);
                  event.target.value = '';
                }}
              />

              {formEvidence.length ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {formEvidence.map((src, index) => (
                    <div key={`${src.slice(0, 50)}-${index}`} className="relative rounded-lg border border-slate-200 bg-white p-1">
                      <button
                        type="button"
                        onClick={() => onRemoveEvidence(index)}
                        className="absolute right-1 top-1 rounded bg-slate-900/75 px-1 text-xs font-semibold text-white"
                        aria-label={`Remove evidence ${index + 1}`}
                      >
                        ×
                      </button>
                      <img
                        src={src}
                        alt={`Evidence ${index + 1}`}
                        className="h-20 w-20 cursor-zoom-in rounded object-cover"
                        onClick={() => setImagePreviewSrc(src)}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeFormModal}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingForm}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmittingForm ? 'Saving...' : editingViolationId ? 'Update Violation' : 'Save Violation'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isDeleteModalOpen}
        title="Delete Violation"
        onClose={closeDeleteModal}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            This action cannot be undone. Do you want to permanently delete this violation record?
          </p>

          {deleteCandidate ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <div><strong>Student:</strong> {deleteCandidate.studentName || '-'}</div>
              <div><strong>Violation Type:</strong> {deleteCandidate.offenseDescription || '-'}</div>
              <div><strong>Incident Date:</strong> {formatDate(deleteCandidate.incidentDate) || '-'}</div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={Boolean(deletingId)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmDeleteViolation}
              disabled={Boolean(deletingId)}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {deletingId ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isDetailModalOpen}
        title="Violation Details"
        onClose={closeDetailModal}
      >
        {detailViolation ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Student</div>
                <div className="text-lg font-semibold text-slate-900">{detailViolation.studentName || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">LRN</div>
                <div className="text-sm text-slate-800">{detailViolation.studentLrn || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</div>
                <div className="mt-1"><StatusBadge statusCode={detailViolation.statusCode} statusLabel={detailViolation.statusLabel} /></div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Grade &amp; Section</div>
                <div className="text-sm text-slate-800">{detailViolation.gradeSection || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Program / Strand</div>
                <div className="text-sm text-slate-800">{detailViolation.strand || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident Date</div>
                <div className="text-sm text-slate-800">{formatDate(detailViolation.incidentDate) || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded Date</div>
                <div className="text-sm text-slate-800">{formatDate(detailViolation.createdAt) || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Violation Type</div>
                <div className="text-sm text-slate-800">{detailViolation.offenseDescription || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident Notes</div>
                <div className="text-sm text-slate-800">{detailViolation.incidentNotes || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sanction</div>
                <div className="text-sm text-slate-800">{detailViolation.sanctionLabel || '-'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remarks</div>
                <div className="text-sm text-slate-800">{detailViolation.remarks || '-'}</div>
              </div>
            </div>

            {parseEvidenceFiles(detailViolation.evidence).length ? (
              <div>
                <h4 className="text-xl font-display text-slate-900">Evidence</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {parseEvidenceFiles(detailViolation.evidence).map((src, index) => (
                    <button
                      key={`${src.slice(0, 50)}-${index}`}
                      type="button"
                      onClick={() => setImagePreviewSrc(src)}
                      className="overflow-hidden rounded-lg border border-slate-200"
                      aria-label={`Open evidence ${index + 1}`}
                    >
                      <img src={src} alt={`Evidence ${index + 1}`} className="h-20 w-20 object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <h4 className="text-xl font-display text-slate-900">All Offenses</h4>
              {isDetailHistoryLoading ? <p className="mt-2 text-sm text-slate-600">Loading offense history...</p> : null}
              {!isDetailHistoryLoading && detailHistoryError ? <p className="mt-2 text-sm text-rose-700">{detailHistoryError}</p> : null}

              {!isDetailHistoryLoading && !detailHistoryError ? (
                <div className="mt-2 space-y-2">
                  {detailHistory.length ? detailHistory.map((entry, index) => (
                    <article key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <h5 className="text-lg font-semibold text-slate-900">Case {index + 1} — {formatDate(entry.incidentDate) || '-'}</h5>
                      <div className="mt-1 space-y-0.5 border-t border-slate-200 pt-1 text-sm text-slate-700">
                        <div><strong>Violation Type:</strong> {entry.offenseDescription || '-'}</div>
                        <div><strong>Sanction:</strong> {entry.sanctionLabel || '-'}</div>
                        <div><strong>Recorded On:</strong> {formatDate(entry.createdAt) || '-'}</div>
                        <div className="flex items-center gap-2"><strong>Status:</strong> <StatusBadge statusCode={entry.statusCode} statusLabel={entry.statusLabel} /></div>
                        <div><strong>Remarks:</strong> {entry.remarks || '-'}</div>
                      </div>
                    </article>
                  )) : <p className="text-sm text-slate-600">No offenses found for this student.</p>}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  closeDetailModal();
                  openEditModal(detailViolation);
                }}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onCycleStatus(detailViolation)}
                className="violation-status-btn violation-status-btn--wide min-w-[140px] rounded-xl px-4 py-2 text-sm font-semibold"
              >
                Set to {toStatusLabel(getNextStatusCode(detailViolation.statusCode))}
              </button>
              <button
                type="button"
                onClick={() => onDeleteViolation(detailViolation)}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Delete
              </button>
            </div>
          </div>
        ) : null}
        
        <div className="mt-6">
          <h4 className="text-xl font-display text-slate-900">Appeals</h4>
          <AppealList appeals={detailAppeals} loading={isDetailAppealsLoading} error={detailAppealsError} />
          <div className="mt-2">
            <a href={`/appeals?violationId=${detailViolation?.id}`} className="text-sm text-sky-600 hover:underline">View in Appeals</a>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(imagePreviewSrc)}
        title="Evidence Preview"
        onClose={() => setImagePreviewSrc('')}
        maxWidth="max-w-3xl"
        bodyClassName="flex items-center justify-center"
      >
        {imagePreviewSrc ? (
          <img
            src={imagePreviewSrc}
            alt="Evidence preview"
            className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
          />
        ) : null}
      </Modal>
      <AppealModal
        isOpen={isAppealModalOpen}
        violation={appealViolation}
        onClose={() => setIsAppealModalOpen(false)}
        onSuccess={() => {
          setIsAppealModalOpen(false);
          setSuccess('Appeal created');
          fetchViolations();

          // Refresh inline appeals for the detail view if the modal was opened from a detail violation
          (async () => {
            try {
              if (!appealViolation?.id) return;
              const aPayload = await apiRequest(`/appeals?violationId=${encodeURIComponent(appealViolation.id)}`);
              const appealsList = Array.isArray(aPayload)
                ? aPayload
                : Array.isArray(aPayload?.data)
                  ? aPayload.data
                  : [];
              setDetailAppeals(appealsList);
            } catch (e) {
              // ignore refresh errors — user sees success banner
            }
          })();
        }}
      />
    </>
  );
}
