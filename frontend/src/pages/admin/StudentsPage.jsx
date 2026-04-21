import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { SuccessBanner } from '../../components/common/SuccessBanner.jsx';
import { apiRequest } from '../../services/api.js';
import { formatDate } from '../../utils/formatDate.js';
import { optionalText } from '../../utils/optionalText.js';

const PAGE_LIMIT = 100;
const MAX_BATCH_ROWS = 1000;
const SEARCH_DEBOUNCE_MS = 300;
const PHOTO_KEY_PREFIX = 'sdms:student-photo:v1:';
const HEADER_ALIASES = {
  lrn: 'lrn',
  student_lrn: 'lrn',
  fullname: 'full_name',
  full_name: 'full_name',
  'full name': 'full_name',
  first_name: 'first_name',
  middle_name: 'middle_name',
  last_name: 'last_name',
  birthdate: 'birthdate',
  dob: 'birthdate',
  dateofbirth: 'birthdate',
  grade: 'grade',
  gradelevel: 'grade',
  section: 'section',
  sectionname: 'section',
  strand: 'strand',
  program: 'strand',
  program_or_strand: 'strand',
  academicgroup: 'strand',
  academic_group: 'strand',
  specialprogram: 'strand',
  special_program: 'strand',
  track: 'strand',
  parent_contact: 'parent_contact',
  parentcontact: 'parent_contact',
  parentcontactnumber: 'parent_contact',
  phone: 'parent_contact'
};

const DEFAULT_FORM = {
  lrn: '',
  firstName: '',
  middleName: '',
  lastName: '',
  birthdate: '',
  gradeLevel: '',
  sectionName: '',
  strand: '',
  parentContact: ''
};

function toPositiveNumber(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDateInput(value) {
  const raw = optionalText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function splitFullName(value) {
  const fullName = optionalText(value);
  if (!fullName) {
    return { firstName: '', middleName: '', lastName: '' };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { firstName: parts[0] || '', middleName: '', lastName: '' };
  }

  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts[parts.length - 1]
  };
}

function composeFullName(firstName, middleName, lastName) {
  return [firstName, middleName, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function getAcademicGroupLabel(gradeLevel) {
  const normalizedGrade = toPositiveNumber(gradeLevel);
  if (!normalizedGrade) {
    return 'Program / Strand';
  }

  return normalizedGrade <= 10 ? 'Program' : 'Strand';
}

function normalizeStudent(row) {
  const firstName = optionalText(row?.firstName ?? row?.first_name) || '';
  const middleName = optionalText(row?.middleName ?? row?.middle_name) || '';
  const lastName = optionalText(row?.lastName ?? row?.last_name) || '';
  const fullName = optionalText(row?.fullName ?? row?.full_name) || composeFullName(firstName, middleName, lastName);
  const rawSectionName = optionalText(row?.sectionName ?? row?.section_name ?? row?.section) || '';
  const rawStrand = optionalText(row?.programName ?? row?.program_name ?? row?.strand) || '';

  return {
    id: row?.id ?? null,
    studentId: row?.studentId ?? row?.student_id ?? null,
    lrn: optionalText(row?.lrn) || '',
    firstName,
    middleName,
    lastName,
    fullName,
    birthdate: normalizeDateInput(row?.birthdate),
    gradeLevel: toPositiveNumber(row?.gradeLevel ?? row?.grade_level ?? row?.grade) || null,
    sectionName: rawSectionName,
    strand: rawStrand,
    parentContact: optionalText(row?.parentContact ?? row?.parent_contact ?? row?.phone) || '',
    active: typeof row?.active === 'boolean' ? row.active : true,
    createdAt: row?.createdAt ?? row?.created_at ?? null,
    updatedAt: row?.updatedAt ?? row?.updated_at ?? null
  };
}

function getStudentRef(student) {
  if (student?.id) return String(student.id);
  if (student?.studentId !== null && student?.studentId !== undefined) return String(student.studentId);
  return null;
}

function getPhotoKeyFromStudent(student) {
  if (!student) return null;
  if (student.id) return `${PHOTO_KEY_PREFIX}id:${student.id}`;
  if (student.lrn) return `${PHOTO_KEY_PREFIX}lrn:${student.lrn}`;
  if (student.studentId !== null && student.studentId !== undefined) return `${PHOTO_KEY_PREFIX}studentId:${student.studentId}`;
  return null;
}

function getStoredPhoto(student) {
  const key = getPhotoKeyFromStudent(student);
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredPhoto(student, photoDataUrl) {
  const key = getPhotoKeyFromStudent(student);
  if (!key || !photoDataUrl) return;
  try {
    localStorage.setItem(key, photoDataUrl);
  } catch {
    // If localStorage quota is exceeded, we silently keep form flow working.
  }
}

function removeStoredPhoto(student) {
  const key = getPhotoKeyFromStudent(student);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup.
  }
}

function moveStoredPhoto(previousStudent, nextStudent) {
  const previousKey = getPhotoKeyFromStudent(previousStudent);
  const nextKey = getPhotoKeyFromStudent(nextStudent);
  if (!previousKey || !nextKey || previousKey === nextKey) return;
  try {
    const existing = localStorage.getItem(previousKey);
    if (!existing) return;
    localStorage.setItem(nextKey, existing);
    localStorage.removeItem(previousKey);
  } catch {
    // Ignore localStorage migration failures and keep API flow unaffected.
  }
}

function initialsFromName(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .slice(0, 2)
    .join('') || '?';
}

function parseCsvLine(line, delimiter) {
  const cells = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      cells.push(value.trim());
      value = '';
      continue;
    }

    value += character;
  }

  cells.push(value.trim());
  return cells;
}

function detectDelimiter(line = '') {
  const semicolon = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  return semicolon > comma ? ';' : ',';
}

function normalizeCsvHeaders(headers) {
  return headers.map((header) => HEADER_ALIASES[String(header || '').toLowerCase().trim()] || null);
}

function serializeCsvTemplate() {
  return [
    'lrn,full_name,birthdate,grade,section,program_or_strand,parent_contact',
    '123456789012,Juan Dela Cruz,2011-04-03,7,A,Regular,09170000000',
    '123456789013,Maria Santos,2009-04-03,11,A,STEM,09170000001'
  ].join('\n');
}

function createStudentPayload(form) {
  const payload = {
    firstName: optionalText(form.firstName),
    middleName: optionalText(form.middleName),
    lastName: optionalText(form.lastName),
    lrn: optionalText(form.lrn),
    birthdate: normalizeDateInput(form.birthdate) || null,
    parentContact: optionalText(form.parentContact)
  };

  const sectionName = optionalText(form.sectionName);
  const gradeLevel = toPositiveNumber(form.gradeLevel);
  const strand = optionalText(form.strand);

  if (gradeLevel) {
    payload.gradeLevel = gradeLevel;
  }

  if (sectionName) {
    payload.sectionName = sectionName;
  }

  if (strand) {
    payload.strand = strand;
  }

  return payload;
}

function Modal({ isOpen, title, onClose, children, maxWidth = 'max-w-3xl', panelClassName = '', bodyClassName = '' }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div className={`w-full ${maxWidth} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${panelClassName}`.trim()} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between bg-gradient-to-r from-teal-700 to-cyan-600 px-5 py-3 text-white">
          <h3 className="text-2xl font-display leading-tight">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xl font-bold transition hover:bg-white/20" aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className={`max-h-[78vh] overflow-y-auto px-5 py-4 ${bodyClassName}`.trim()}>{children}</div>
      </div>
    </div>
  );
}

function ViewIcon() {
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

export function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [sections, setSections] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingSections, setLoadingSections] = useState(false);
  const [submittingForm, setSubmittingForm] = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [strandFilter, setStrandFilter] = useState('');
  const [activeFilter] = useState('true');
  const [page, setPage] = useState(1);
  const [limit] = useState(PAGE_LIMIT);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [viewingStudent, setViewingStudent] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formPhotoDataUrl, setFormPhotoDataUrl] = useState('');
  const [formSectionInputMode, setFormSectionInputMode] = useState(false);
  const [photoDropActive, setPhotoDropActive] = useState(false);

  const [batchFileName, setBatchFileName] = useState('');
  const [batchRows, setBatchRows] = useState([]);
  const [batchParseErrors, setBatchParseErrors] = useState([]);
  const [batchUploadSummary, setBatchUploadSummary] = useState(null);
  const [batchDropActive, setBatchDropActive] = useState(false);

  const fileInputRef = useRef(null);
  const batchFileInputRef = useRef(null);
  const batchAutoCloseTimerRef = useRef(null);
  const studentRequestSequenceRef = useRef(0);

  const clearBatchAutoCloseTimer = useCallback(() => {
    if (batchAutoCloseTimerRef.current !== null) {
      window.clearTimeout(batchAutoCloseTimerRef.current);
      batchAutoCloseTimerRef.current = null;
    }
  }, []);

  const closeBatchModal = useCallback(() => {
    clearBatchAutoCloseTimer();
    setIsBatchModalOpen(false);
  }, [clearBatchAutoCloseTimer]);

  const openBatchModal = useCallback(() => {
    clearBatchAutoCloseTimer();
    setIsBatchModalOpen(true);
  }, [clearBatchAutoCloseTimer]);

  const gradeOptions = useMemo(() => {
    const fromSections = sections.map((section) => toPositiveNumber(section.gradeLevel)).filter(Boolean);
    return [...new Set(fromSections)].sort((left, right) => left - right);
  }, [sections]);

  const strandOptions = useMemo(() => {
    const source = [
      ...sections.map((section) => optionalText(section.strand)),
      ...students.map((student) => optionalText(student.strand))
    ].filter(Boolean);
    return [...new Set(source)].sort((left, right) => left.localeCompare(right));
  }, [sections, students]);

  const sectionOptionsForForm = useMemo(() => {
    const gradeLevel = toPositiveNumber(form.gradeLevel);
    const academicGroup = optionalText(form.strand);
    if (!gradeLevel || !academicGroup) return [];

    const options = sections
      .filter((section) => (
        toPositiveNumber(section.gradeLevel) === gradeLevel
        && optionalText(section.strand) === academicGroup
      ))
      .map((section) => optionalText(section.sectionName))
      .filter(Boolean);

    return [...new Set(options)].sort((left, right) => left.localeCompare(right));
  }, [form.gradeLevel, form.strand, sections]);

  const strandOptionsForForm = useMemo(() => {
    const gradeLevel = toPositiveNumber(form.gradeLevel);
    if (!gradeLevel) return [];

    const options = sections
      .filter((section) => toPositiveNumber(section.gradeLevel) === gradeLevel)
      .map((section) => optionalText(section.strand))
      .filter(Boolean);

    return [...new Set(options)].sort((left, right) => left.localeCompare(right));
  }, [form.gradeLevel, sections]);

  const tableSummary = useMemo(() => {
    if (!totalItems) return 'Showing 0 of 0';
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, totalItems);
    return `Showing ${start}-${end} of ${totalItems}`;
  }, [limit, page, totalItems]);

  const hasSearchOrFilters = useMemo(() => {
    return Boolean(optionalText(searchTerm) || optionalText(gradeFilter) || optionalText(strandFilter));
  }, [gradeFilter, searchTerm, strandFilter]);

  const emptyStateMessage = useMemo(() => {
    return hasSearchOrFilters
      ? 'No students match the current search and filters.'
      : 'No students found.';
  }, [hasSearchOrFilters]);

  const isSearchPending = searchInput !== searchTerm;

  const pageWindow = useMemo(() => {
    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = start + windowSize - 1;

    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - windowSize + 1);
    }

    const result = [];
    for (let cursor = start; cursor <= end; cursor += 1) {
      result.push(cursor);
    }
    return result;
  }, [page, totalPages]);

  const fetchSections = useCallback(async () => {
    try {
      setLoadingSections(true);
      const payload = await apiRequest('/settings/sections');
      const rows = Array.isArray(payload) ? payload : [];
      setSections(rows);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load section options');
    } finally {
      setLoadingSections(false);
    }
  }, []);

  const fetchStudents = useCallback(async () => {
    const requestSequence = studentRequestSequenceRef.current + 1;
    studentRequestSequenceRef.current = requestSequence;

    try {
      setLoadingStudents(true);
      setError('');

      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (optionalText(searchTerm)) params.set('q', searchTerm.trim());
      if (optionalText(gradeFilter)) params.set('gradeLevel', gradeFilter.trim());
      if (optionalText(strandFilter)) params.set('strand', strandFilter.trim());
      if (optionalText(activeFilter)) params.set('active', activeFilter.trim());

      const payload = await apiRequest(`/students?${params.toString()}`);
      if (requestSequence !== studentRequestSequenceRef.current) return;

      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

      setStudents(rows.map(normalizeStudent));
      setTotalItems(Number(payload?.totalItems) || 0);
      setTotalPages(Math.max(1, Number(payload?.totalPages) || 1));
    } catch (loadError) {
      if (requestSequence !== studentRequestSequenceRef.current) return;

      setError(loadError.message || 'Failed to load students');
      setStudents([]);
      setTotalItems(0);
      setTotalPages(1);
    } finally {
      if (requestSequence === studentRequestSequenceRef.current) {
        setLoadingStudents(false);
      }
    }
  }, [activeFilter, gradeFilter, limit, page, searchTerm, strandFilter]);

  useEffect(() => {
    fetchSections();
  }, [fetchSections]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => {
      setPage((previous) => (previous === 1 ? previous : 1));
      setSearchTerm((previous) => (previous === searchInput ? previous : searchInput));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(debounceTimer);
    };
  }, [searchInput]);

  useEffect(() => {
    return () => {
      clearBatchAutoCloseTimer();
    };
  }, [clearBatchAutoCloseTimer]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsFormModalOpen(false);
        setIsViewModalOpen(false);
        closeBatchModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeBatchModal]);

  const resetFormState = () => {
    setForm(DEFAULT_FORM);
    setEditingStudent(null);
    setFormPhotoDataUrl('');
    setFormSectionInputMode(false);
  };

  const openCreateModal = () => {
    resetFormState();
    setIsFormModalOpen(true);
  };

  const openEditModal = (student) => {
    setEditingStudent(student);
    setForm({
      lrn: student.lrn || '',
      firstName: student.firstName || '',
      middleName: student.middleName || '',
      lastName: student.lastName || '',
      birthdate: normalizeDateInput(student.birthdate),
      gradeLevel: student.gradeLevel ? String(student.gradeLevel) : '',
      sectionName: student.sectionName || '',
      strand: student.strand || '',
      parentContact: student.parentContact || ''
    });
    setFormPhotoDataUrl(getStoredPhoto(student) || '');
    setFormSectionInputMode(false);
    setIsFormModalOpen(true);
  };

  const openViewModal = (student) => {
    setViewingStudent(student);
    setIsViewModalOpen(true);
  };

  const onApplySearch = (event) => {
    event.preventDefault();
    setPage(1);
    setSearchTerm(searchInput);
  };

  const onFilterChange = (setter) => (event) => {
    const nextValue = event.target.value;
    setPage(1);
    setter(nextValue);
    setSearchTerm(searchInput);
  };

  const processPhotoFile = async (file) => {
    if (!file) return;

    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setError('Photo must be JPG, PNG, or WEBP.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Photo must be smaller than 2MB.');
      return;
    }

    setError('');

    try {
      const reader = new FileReader();
      const fileData = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read photo file'));
        reader.readAsDataURL(file);
      });
      setFormPhotoDataUrl(fileData);
    } catch {
      setError('Unable to process selected image.');
    }
  };

  const onUploadPhoto = async (event) => {
    const file = event.target.files?.[0];
    await processPhotoFile(file);
    event.target.value = '';
  };

  const onPhotoDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPhotoDropActive(false);
    const file = event.dataTransfer?.files?.[0];
    await processPhotoFile(file);
  };

  const onSubmitForm = async (event) => {
    event.preventDefault();
    setSubmittingForm(true);
    setError('');
    setSuccess('');

    try {
      const payload = createStudentPayload(form);
      if (!payload.firstName || !payload.lastName) {
        throw new Error('First Name and Last Name are required.');
      }
      if (!payload.gradeLevel) {
        throw new Error('Grade is required.');
      }
      if (!payload.sectionName) {
        throw new Error('Section is required.');
      }
      if (payload.gradeLevel >= 11 && !optionalText(payload.strand)) {
        throw new Error('Strand is required for Grades 11 and 12.');
      }
      if (payload.lrn && !/^\d{1,12}$/.test(payload.lrn)) {
        throw new Error('LRN must only contain digits and have at most 12 numbers.');
      }

      const studentRef = getStudentRef(editingStudent);
      const result = editingStudent && studentRef
        ? await apiRequest(`/students/${studentRef}`, { method: 'PATCH', body: payload })
        : await apiRequest('/students', { method: 'POST', body: payload });

      const normalizedSaved = normalizeStudent(result);

      if (editingStudent) {
        moveStoredPhoto(editingStudent, normalizedSaved);
      }

      if (formPhotoDataUrl) {
        setStoredPhoto(normalizedSaved, formPhotoDataUrl);
      } else if (editingStudent) {
        removeStoredPhoto(editingStudent);
        removeStoredPhoto(normalizedSaved);
      }

      setSuccess(editingStudent ? 'Student updated successfully.' : 'Student added successfully.');
      setIsFormModalOpen(false);
      resetFormState();
      await fetchStudents();
    } catch (submitError) {
      setError(submitError.message || 'Failed to save student');
    } finally {
      setSubmittingForm(false);
    }
  };

  const onDeleteStudent = async (student) => {
    const studentRef = getStudentRef(student);
    if (!studentRef) {
      setError('Unable to determine student reference for deletion.');
      return;
    }

    const confirmed = window.confirm(`Are you sure you want to delete ${student.fullName || 'this student'}?`);
    if (!confirmed) return;

    try {
      setError('');
      await apiRequest(`/students/${studentRef}`, { method: 'DELETE' });
      removeStoredPhoto(student);
      setSuccess('Student deleted successfully.');

      if (students.length === 1 && page > 1) {
        setPage((previous) => Math.max(1, previous - 1));
      } else {
        await fetchStudents();
      }
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete student');
    }
  };

  const onDownloadTemplate = () => {
    const blob = new Blob([serializeCsvTemplate()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sdms_students_template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const parseCsvText = (rawText) => {
    const parseErrors = [];
    const text = String(rawText || '').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (!lines.length) {
      return { rows: [], errors: ['CSV file is empty.'] };
    }

    const delimiter = detectDelimiter(lines[0]);
    const firstLine = parseCsvLine(lines[0], delimiter);
    const normalizedHeaders = normalizeCsvHeaders(firstLine);
    const hasHeader = normalizedHeaders.some(Boolean);

    const headerIndex = new Map();
    normalizedHeaders.forEach((header, index) => {
      if (header) {
        headerIndex.set(header, index);
      }
    });

    const dataLines = hasHeader ? lines.slice(1) : lines;
      const defaultOrder = ['lrn', 'full_name', 'birthdate', 'grade', 'section', 'strand', 'parent_contact'];

    const rows = dataLines.map((line, index) => {
      const cells = parseCsvLine(line, delimiter);
      const pickCell = (name, fallback) => {
        if (hasHeader && headerIndex.has(name)) {
          return cells[headerIndex.get(name)] || '';
        }
        const fallbackIndex = defaultOrder.indexOf(name);
        if (fallbackIndex >= 0) return cells[fallbackIndex] || fallback;
        return fallback;
      };

      const fullName = optionalText(pickCell('full_name', '')) || composeFullName(
        optionalText(pickCell('first_name', '')),
        optionalText(pickCell('middle_name', '')),
        optionalText(pickCell('last_name', ''))
      );

      const gradeLevel = optionalText(pickCell('grade', ''));
      const sectionName = optionalText(pickCell('section', ''));
      const rowErrors = [];
      const lrn = optionalText(pickCell('lrn', '')) || '';
      const birthdate = normalizeDateInput(pickCell('birthdate', ''));
      const academicGroup = optionalText(pickCell('strand', '')) || '';
      const numericGradeLevel = toPositiveNumber(gradeLevel);

      if (!fullName) rowErrors.push('Missing full name');
      if (!gradeLevel || !numericGradeLevel) rowErrors.push('Missing/invalid grade');
      if (!sectionName) rowErrors.push('Missing section');
      if (numericGradeLevel >= 11 && !academicGroup) rowErrors.push('Missing strand');
      if (lrn && !/^\d{1,12}$/.test(lrn)) rowErrors.push('LRN must contain digits only (max 12)');
      if (pickCell('birthdate', '') && !birthdate) rowErrors.push('Invalid birthdate');

      return {
        rowNumber: hasHeader ? index + 2 : index + 1,
        lrn,
        fullName,
        birthdate,
        gradeLevel: gradeLevel || '',
        sectionName: sectionName || '',
        strand: academicGroup,
        parentContact: optionalText(pickCell('parent_contact', '')) || '',
        errors: rowErrors
      };
    });

    if (!hasHeader) {
      parseErrors.push('Header row was not detected. Parsed using default column order.');
    }

    return { rows, errors: parseErrors };
  };

  const processBatchFile = async (file) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Batch file must be a .csv file.');
      return;
    }

    setBatchUploadSummary(null);
    setBatchFileName(file.name);

    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      if (parsed.rows.length > MAX_BATCH_ROWS) {
        setBatchRows([]);
        setBatchParseErrors([
          ...parsed.errors,
          `CSV contains ${parsed.rows.length} rows. Maximum supported is ${MAX_BATCH_ROWS}.`
        ]);
        setError(`Batch upload supports up to ${MAX_BATCH_ROWS} rows per upload.`);
        return;
      }
      setBatchRows(parsed.rows);
      setBatchParseErrors(parsed.errors);
      setSuccess(`Parsed ${parsed.rows.length} row(s).`);
    } catch {
      setError('Unable to parse CSV file.');
      setBatchRows([]);
      setBatchParseErrors([]);
    }
  };

  const onBatchFileSelected = async (event) => {
    const file = event.target.files?.[0];
    await processBatchFile(file);
    event.target.value = '';
  };

  const onBatchDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setBatchDropActive(false);
    const file = event.dataTransfer?.files?.[0];
    await processBatchFile(file);
  };

  const uploadBatchFallbackSequential = async (validRows) => {
    const failures = [];
    let inserted = 0;

    for (const row of validRows) {
      const names = splitFullName(row.fullName);

      try {
        await apiRequest('/students', {
          method: 'POST',
          body: {
            firstName: names.firstName,
            middleName: optionalText(names.middleName),
            lastName: names.lastName,
            lrn: optionalText(row.lrn),
            birthdate: optionalText(row.birthdate),
            gradeLevel: toPositiveNumber(row.gradeLevel),
            sectionName: row.sectionName,
            strand: row.strand || null,
            parentContact: optionalText(row.parentContact)
          }
        });
        inserted += 1;
      } catch (rowError) {
        failures.push({ row: row.rowNumber, error: rowError.message || 'Upload failed' });
      }
    }

    return {
      inserted,
      skipped: 0,
      failed: failures.length,
      errors: failures
    };
  };

  const toBatchSummary = (summary) => ({
    inserted: Number(summary?.inserted) || 0,
    skipped: Number(summary?.skipped) || 0,
    failed: Number(summary?.failed) || 0,
    errors: Array.isArray(summary?.errors) ? summary.errors : []
  });

  const onConfirmBatchUpload = async () => {
    const validRows = batchRows.filter((row) => !row.errors.length);
    if (!validRows.length) {
      setError('No valid rows to upload. Please fix errors first.');
      return;
    }
    if (validRows.length > MAX_BATCH_ROWS) {
      setError(`Batch upload supports up to ${MAX_BATCH_ROWS} valid rows per upload.`);
      return;
    }

    clearBatchAutoCloseTimer();
    setSubmittingBatch(true);
    setError('');

    try {
      let summary = null;

      try {
        summary = await apiRequest('/students/batch', {
          method: 'POST',
          body: {
            students: validRows.map((row) => ({
              lrn: row.lrn || null,
              full_name: row.fullName,
              birthdate: row.birthdate || null,
              grade: String(row.gradeLevel),
              section: row.sectionName,
              strand: row.strand || null,
              parent_contact: row.parentContact || null
            }))
          }
        });
      } catch (batchError) {
        if (batchError.status === 404 || batchError.status === 405) {
          summary = await uploadBatchFallbackSequential(validRows);
        } else {
          throw batchError;
        }
      }

      const normalizedSummary = toBatchSummary(summary);
      setBatchUploadSummary(normalizedSummary);

      if (normalizedSummary.failed > 0 || normalizedSummary.skipped > 0) {
        setSuccess(
          `Batch upload completed: ${normalizedSummary.inserted} inserted, ${normalizedSummary.skipped} skipped, ${normalizedSummary.failed} failed.`
        );
      } else {
        setSuccess(`Batch upload successful: ${normalizedSummary.inserted} student(s) inserted.`);
        batchAutoCloseTimerRef.current = window.setTimeout(() => {
          batchAutoCloseTimerRef.current = null;
          setIsBatchModalOpen(false);
        }, 5000);
      }

      setPage(1);
      await fetchStudents();
    } catch (batchError) {
      const payloadSummary = batchError?.payload;
      if (payloadSummary && typeof payloadSummary === 'object' && (
        payloadSummary.inserted !== undefined
        || payloadSummary.skipped !== undefined
        || payloadSummary.failed !== undefined
        || Array.isArray(payloadSummary.errors)
      )) {
        const normalizedSummary = toBatchSummary(payloadSummary);
        setBatchUploadSummary(normalizedSummary);
        setError(
          `Batch upload finished with validation issues: ${normalizedSummary.inserted} inserted, ${normalizedSummary.skipped} skipped, ${normalizedSummary.failed} failed.`
        );
        setPage(1);
        await fetchStudents();
        return;
      }

      setError(batchError.message || 'Batch upload failed');
    } finally {
      setSubmittingBatch(false);
    }
  };

  return (
    <>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <SectionCard title="Student Directory">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={openCreateModal} className="student-primary-btn rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">
            + Add Student
          </button>
          <button type="button" onClick={openBatchModal} className="student-primary-btn rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">
            Batch Upload
          </button>
        </div>

        <form className="mb-4 grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={onApplySearch}>
          <div className="relative">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name, LRN, or student #"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 pr-10 text-sm outline-none ring-teal-500 transition focus:ring"
            />
            {(isSearchPending || loadingStudents) ? (
              <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-slate-400" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none">
                  <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="2" />
                  <path d="M21 12a9 9 0 0 0-9-9" className="opacity-90" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            ) : null}
          </div>
          <select value={strandFilter} onChange={onFilterChange(setStrandFilter)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Programs / Strands</option>
            {strandOptions.map((strand) => (
              <option key={strand} value={strand}>{strand}</option>
            ))}
          </select>
          <select value={gradeFilter} onChange={onFilterChange(setGradeFilter)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Grades</option>
            {gradeOptions.map((grade) => (
              <option key={grade} value={String(grade)}>{`Grade ${grade}`}</option>
            ))}
          </select>
          <button type="submit" className="student-primary-btn rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800">
            Search
          </button>
        </form>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="student-table-head border-b border-slate-200">
                <th className="py-2 pr-3">LRN</th>
                <th className="py-2 pr-3">First Name</th>
                <th className="py-2 pr-3">Middle Name</th>
                <th className="py-2 pr-3">Last Name</th>
                <th className="py-2 pr-3">Birthdate</th>
                <th className="py-2 pr-3">Grade</th>
                <th className="py-2 pr-3">Section</th>
                <th className="py-2 pr-3">Program / Strand</th>
                <th className="py-2 pr-3">Added Date</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingStudents ? (
                <tr>
                  <td colSpan={10} className="py-4 text-slate-500">Loading students...</td>
                </tr>
              ) : null}

              {!loadingStudents && students.map((student) => {
                return (
                  <tr key={student.id || student.studentId || `${student.lrn}-${student.fullName}`} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{student.lrn || '-'}</td>
                    <td className="py-2 pr-3 font-semibold text-slate-800">{student.firstName || '-'}</td>
                    <td className="py-2 pr-3">{student.middleName || '-'}</td>
                    <td className="py-2 pr-3">{student.lastName || '-'}</td>
                    <td className="py-2 pr-3">{formatDate(student.birthdate)}</td>
                    <td className="py-2 pr-3">{student.gradeLevel ? String(student.gradeLevel) : '-'}</td>
                    <td className="py-2 pr-3">{student.sectionName || '-'}</td>
                    <td className="py-2 pr-3">{student.strand || '-'}</td>
                    <td className="py-2 pr-3">{formatDate(student.createdAt)}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openViewModal(student)}
                          className="student-action-btn student-action-btn--view"
                          aria-label={`View ${student.fullName || 'student'}`}
                          title="View"
                        >
                          <ViewIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(student)}
                          className="student-action-btn student-action-btn--edit"
                          aria-label={`Edit ${student.fullName || 'student'}`}
                          title="Edit"
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteStudent(student)}
                          className="student-action-btn student-action-btn--delete"
                          aria-label={`Delete ${student.fullName || 'student'}`}
                          title="Delete"
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loadingStudents && !students.length ? (
                <tr>
                  <td colSpan={10} className="py-4 text-slate-500">{emptyStateMessage}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">{tableSummary}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              disabled={page <= 1}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            {pageWindow.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={`rounded border px-3 py-1.5 text-sm ${pageNumber === page ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
              disabled={page >= totalPages}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </SectionCard>

      <Modal
        isOpen={isFormModalOpen}
        title={editingStudent ? 'Edit Student' : 'Add Student'}
        onClose={() => setIsFormModalOpen(false)}
        panelClassName="student-single-modal-panel"
        bodyClassName="student-single-modal-body"
      >
        <form onSubmit={onSubmitForm} className="student-single-modal grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">Student Photo</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {formPhotoDataUrl ? (
                  <img src={formPhotoDataUrl} alt="Selected student" className="h-20 w-20 rounded-full border border-slate-200 object-cover" />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-full border border-slate-200 bg-slate-100 text-base font-bold text-slate-700">
                    {initialsFromName(composeFullName(form.firstName, form.middleName, form.lastName) || 'Student')}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-700">Drag and drop image or browse</p>
                  <p className="text-xs text-slate-500">JPG/PNG/WEBP, max 2MB. Auto-saved locally for this browser.</p>
                </div>
              </div>

              <div
                className={`rounded-xl border-2 border-dashed p-4 text-center transition ${photoDropActive ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white'}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setPhotoDropActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setPhotoDropActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setPhotoDropActive(false);
                }}
                onDrop={onPhotoDrop}
                role="presentation"
              >
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
                    Choose Photo
                  </button>
                  <button type="button" onClick={() => setFormPhotoDataUrl('')} className="student-single-secondary-btn rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                    Remove
                  </button>
                </div>
              </div>

              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onUploadPhoto} className="hidden" />
            </div>
          </div>

          <label className="text-sm font-semibold text-slate-700">
            LRN
            <input
              value={form.lrn}
              onChange={(event) => setForm((previous) => ({ ...previous, lrn: event.target.value.replace(/\D+/g, '').slice(0, 12) }))}
              placeholder="12-digit number"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Parent Contact
            <input
              value={form.parentContact}
              onChange={(event) => setForm((previous) => ({ ...previous, parentContact: event.target.value.replace(/\D+/g, '').slice(0, 11) }))}
              placeholder="11-digit number"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            First Name
            <input
              required
              value={form.firstName}
              onChange={(event) => setForm((previous) => ({ ...previous, firstName: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Middle Name
            <input
              value={form.middleName}
              onChange={(event) => setForm((previous) => ({ ...previous, middleName: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Last Name
            <input
              required
              value={form.lastName}
              onChange={(event) => setForm((previous) => ({ ...previous, lastName: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Birthdate
            <input
              type="date"
              value={form.birthdate}
              onChange={(event) => setForm((previous) => ({ ...previous, birthdate: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Grade
            <select
              required
              value={form.gradeLevel}
              onChange={(event) => {
                const nextGrade = event.target.value;
                const nextGradeNumber = toPositiveNumber(nextGrade);
                const nextAcademicGroup = nextGradeNumber && nextGradeNumber <= 10 ? 'Regular' : '';
                setForm((previous) => ({ ...previous, gradeLevel: nextGrade, sectionName: '', strand: nextAcademicGroup }));
                setFormSectionInputMode(false);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select Grade</option>
              {gradeOptions.map((grade) => (
                <option key={grade} value={String(grade)}>{`Grade ${grade}`}</option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            {getAcademicGroupLabel(form.gradeLevel)}
            <select
              required={toPositiveNumber(form.gradeLevel) >= 11}
              value={form.strand}
              onChange={(event) => {
                setForm((previous) => ({
                  ...previous,
                  strand: event.target.value,
                  sectionName: ''
                }));
                setFormSectionInputMode(false);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{`Select ${getAcademicGroupLabel(form.gradeLevel)}`}</option>
              {strandOptionsForForm.map((strand) => (
                <option key={strand} value={strand}>{strand}</option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Section
            {!formSectionInputMode ? (
              <select
                value={form.sectionName}
                onChange={(event) => {
                  if (event.target.value === '__custom__') {
                    setFormSectionInputMode(true);
                    setForm((previous) => ({ ...previous, sectionName: '' }));
                    return;
                  }
                  setForm((previous) => ({
                    ...previous,
                    sectionName: event.target.value
                  }));
                }}
                disabled={!optionalText(form.strand)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                <option value="">{optionalText(form.strand) ? 'Select Section' : 'Select Program/Strand First'}</option>
                {sectionOptionsForForm.map((sectionName) => (
                  <option key={sectionName} value={sectionName}>{sectionName}</option>
                ))}
                <option value="__custom__">Other (type manually)</option>
              </select>
            ) : (
              <div className="mt-1 flex gap-2">
                <input
                  value={form.sectionName}
                  onChange={(event) => setForm((previous) => ({ ...previous, sectionName: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Type section"
                />
                <button type="button" onClick={() => setFormSectionInputMode(false)} className="student-single-secondary-btn rounded-lg border border-slate-300 px-3 py-2 text-xs">Use list</button>
              </div>
            )}
          </label>

          <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsFormModalOpen(false)}
              className="student-single-secondary-btn rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingForm || loadingSections}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submittingForm ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isViewModalOpen}
        title="Student Details"
        onClose={() => setIsViewModalOpen(false)}
        maxWidth="max-w-2xl"
        panelClassName="student-single-modal-panel"
        bodyClassName="student-single-modal-body"
      >
        {viewingStudent ? (
          <div className="student-single-modal grid gap-4 sm:grid-cols-[110px_1fr]">
            <div className="flex items-start justify-center">
              {getStoredPhoto(viewingStudent) ? (
                <img src={getStoredPhoto(viewingStudent)} alt={viewingStudent.fullName} className="h-24 w-24 rounded-full border border-slate-200 object-cover" />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-full border border-slate-200 bg-slate-100 text-4xl font-bold text-slate-700">
                  {initialsFromName(viewingStudent.fullName)}
                </div>
              )}
            </div>

            <div className="space-y-2">
              {[['LRN', viewingStudent.lrn || '-'], ['Name', viewingStudent.fullName || '-'], ['Birthdate', formatDate(viewingStudent.birthdate)], ['Grade', viewingStudent.gradeLevel || '-'], ['Section', viewingStudent.sectionName || '-'], ['Program / Strand', viewingStudent.strand || '-'], ["Parent Contact", viewingStudent.parentContact || '-']].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[140px_1fr] border-b border-slate-100 pb-1 text-sm">
                  <span className="font-semibold text-slate-700">{label}</span>
                  <span className="text-right text-slate-800">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={isBatchModalOpen}
        title="Batch Upload Students"
        onClose={closeBatchModal}
        maxWidth="max-w-5xl"
        panelClassName="batch-upload-panel"
        bodyClassName="batch-upload-body"
      >
        <div className="batch-upload-modal space-y-4">
          <div className="batch-upload-card rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              Upload a CSV file with headers in any order. Recognized fields include LRN, Full Name, Birthdate, Grade, Section, Program/Strand, and Parent Contact.
            </p>
            <p className="mt-1 text-xs text-slate-500">Maximum rows per upload: {MAX_BATCH_ROWS}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={onDownloadTemplate} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
                Download CSV Template
              </button>
              <button type="button" onClick={() => batchFileInputRef.current?.click()} className="batch-upload-secondary-btn rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                Choose CSV File
              </button>
              <span className="batch-upload-file-name text-sm text-slate-500">{batchFileName || 'No file selected'}</span>
              <input ref={batchFileInputRef} type="file" accept=".csv,text/csv" onChange={onBatchFileSelected} className="hidden" />
            </div>

            <div
              className={`batch-upload-dropzone mt-3 rounded-xl border-2 border-dashed p-5 text-center transition ${batchDropActive ? 'batch-upload-dropzone--active border-teal-500 bg-teal-50' : 'border-slate-300 bg-white'}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setBatchDropActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setBatchDropActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setBatchDropActive(false);
              }}
              onDrop={onBatchDrop}
              role="presentation"
            >
              <p className="text-sm font-semibold text-slate-700">Drag and drop your CSV file here</p>
              <p className="text-xs text-slate-500">or use the Choose CSV File button above</p>
            </div>
          </div>

          {batchParseErrors.length ? (
            <div className="batch-upload-parse-errors rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {batchParseErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          ) : null}

          {batchRows.length ? (
            <div className="batch-upload-preview-wrap overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="batch-upload-preview-head bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">LRN</th>
                    <th className="px-3 py-2">Full Name</th>
                    <th className="px-3 py-2">Birthdate</th>
                    <th className="px-3 py-2">Grade</th>
                    <th className="px-3 py-2">Section</th>
                    <th className="px-3 py-2">Program / Strand</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row) => (
                    <tr key={row.rowNumber} className="batch-upload-preview-row border-t border-slate-100">
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2">{row.lrn || '-'}</td>
                      <td className="px-3 py-2">{row.fullName || '-'}</td>
                      <td className="px-3 py-2">{row.birthdate || '-'}</td>
                      <td className="px-3 py-2">{row.gradeLevel || '-'}</td>
                      <td className="px-3 py-2">{row.sectionName || '-'}</td>
                      <td className="px-3 py-2">{row.strand || '-'}</td>
                      <td className="px-3 py-2">
                        {row.errors.length ? (
                          <span className="text-xs font-semibold text-rose-700">{row.errors.join('; ')}</span>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700">Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {batchUploadSummary ? (
            <div className="batch-upload-summary rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>{`Inserted: ${batchUploadSummary.inserted} | Skipped: ${batchUploadSummary.skipped} | Failed: ${batchUploadSummary.failed}`}</p>
              {batchUploadSummary.errors?.length ? (
                <div className="mt-2 space-y-1">
                  {batchUploadSummary.errors.map((item, index) => (
                    <p key={`${item.rowNumber || item.row || 'row'}-${index}`} className="text-rose-700">{`Row ${item.rowNumber ?? item.row ?? '?'}: ${item.message || item.error || item.reason || 'Upload failed'}`}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeBatchModal}
              className="batch-upload-close-btn rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onConfirmBatchUpload}
              disabled={submittingBatch || !batchRows.length}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submittingBatch ? 'Uploading...' : 'Upload Valid Rows'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
