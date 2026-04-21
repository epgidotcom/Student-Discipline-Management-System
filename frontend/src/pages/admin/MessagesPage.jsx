import { useEffect, useState } from 'react';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { SuccessBanner } from '../../components/common/SuccessBanner.jsx';
import { apiRequest, sendMessage } from '../../services/api.js';
import { optionalText } from '../../utils/optionalText.js';

export function MessagesPage() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Compose form state
  const [manualPhones, setManualPhones] = useState('');
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [pendingFill, setPendingFill] = useState(null); // { parentContact, display }
  const [gradeSection, setGradeSection] = useState('');
  const [violation, setViolation] = useState('');
  const [sanction, setSanction] = useState('');
  const [date, setDate] = useState('');
  const [teacher, setTeacher] = useState('');
  const [violationType, setViolationType] = useState('');
  const [optionalTextInput, setOptionalTextInput] = useState('');
  const [messageText, setMessageText] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [busy, setBusy] = useState(false);
  const charLimit = 320;

  // Debounced student search for the combined Student+LRN input
  useEffect(() => {
    if (!studentQuery || studentQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const res = await apiRequest(`/students?q=${encodeURIComponent(studentQuery)}&limit=8`);
        const studentsList = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setSuggestions(studentsList);
      } catch (e) {
        // ignore search errors
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [studentQuery]);

  const formatStudentDisplay = (s) => {
    if (!s) return '';
    const name = s.fullName || `${s.firstName || ''} ${s.lastName || ''}`.trim();
    return s.lrn ? `${name} (${s.lrn})` : name;
  };

  const parseRecipients = () => {
    if (!manualPhones) return [];
    return manualPhones
      .split(/[,;\n\r]+/)
      .map((p) => p.trim().replace(/[^\d+]/g, ''))
      .filter(Boolean);
  };

  const buildBaseMessage = () => {
    const name = studentName || '[Student Name]';
    const gs = gradeSection || '[Grade/Section]';
    const vt = violationType || '';
    const v = violation || '';
    const s = sanction || '';
    const d = date || '';
    const t = teacher || '';

    let base = `Dear Parent/Guardian, ${name} (${gs})`;
    if (vt || v) base += ` was recorded for ${vt}${v ? `: ${v}` : ''}`;
    if (d) base += ` on ${d}`;
    if (t) base += ` by ${t}`;
    base += '.';
    if (s) base += ` Sanction: ${s}.`;
    if (optionalTextInput && optionalTextInput.trim()) base += ` ${optionalTextInput.trim()}`;
    base += ` This is a one-way message and replies to this channel are not monitored. If you would like to receive a response, please include a valid Gmail address so the recipient can reply and you can view their message there.`;
    return base;
  };

  const generateMessage = async () => {
    const final = buildBaseMessage();
    setMessageText(final);
    setPreviewText(final);
    return final;
  };

  const handlePreview = async () => {
    setBusy(true);
    try {
      const msg = messageText || (await generateMessage());
      const recipients = parseRecipients();
      const resp = await sendMessage({
        messageTypeCode: 'general_notice',
        studentId: optionalText(studentId),
        messageText: msg,
        manualPhones: recipients.length ? recipients : undefined,
        previewOnly: true,
      });

      if (resp && (resp.preview || resp.message)) {
        setPreviewText(resp.preview || resp.message);
      } else if (resp && resp.error) {
        setPreviewText(`Preview error: ${resp.error}`);
      } else {
        setPreviewText(msg);
      }
    } catch (e) {
      setPreviewText(`Preview error: ${e?.message || e}`);
    }
    setBusy(false);
  };

  const handleSend = async () => {
    setBusy(true);
    try {
      // The message textarea is the single source of truth for the outgoing message.
      const msg = (messageText || '').trim();
      if (!msg) {
        alert('Please enter the message text in the Message box or click Generate.');
        setBusy(false);
        return;
      }

      const recipients = parseRecipients();
      if (recipients.length === 0 && !studentId) {
        alert('Please provide a student or at least one phone number');
        setBusy(false);
        return;
      }

      const body = {
        messageTypeCode: 'general_notice',
        studentId: optionalText(studentId),
        messageText: msg,
        manualPhones: recipients.length ? recipients : undefined,
        previewOnly: false,
        sendNow: true // ask backend to attempt immediate delivery
      };

      const resp = await sendMessage(body);
      setSuccess('Message sent.');
      setError('');
    } catch (e) {
      setError(e?.message || 'Failed to send message');
    }
    setBusy(false);
  };

  const resetAll = () => {
    setManualPhones('');
    setStudentId('');
    setStudentName('');
    setStudentQuery('');
    setGradeSection('');
    setViolation('');
    setSanction('');
    setDate('');
    setTeacher('');
    setViolationType('');
    setOptionalTextInput('');
    setMessageText('');
    setPreviewText('');
    setBusy(false);
    setError('');
    setSuccess('');
  };

  const handleSelectSuggestion = (s) => {
    const display = formatStudentDisplay(s);
    setStudentId(s.id);
    setStudentName(display);
    setStudentQuery(display);
    setSuggestions([]);
    const parent = s.parentContact || '';
    if (parent) {
      if (!manualPhones || !manualPhones.trim()) {
        setManualPhones(parent);
      } else {
        setPendingFill({ parentContact: parent, display });
      }
    }
  };

  const applyReplaceManual = () => {
    if (!pendingFill) return;
    setManualPhones(pendingFill.parentContact || '');
    setPendingFill(null);
  };

  const applyAppendManual = () => {
    if (!pendingFill) return;
    setManualPhones((prev) => (prev && prev.trim() ? `${prev.trim()}, ${pendingFill.parentContact}` : pendingFill.parentContact));
    setPendingFill(null);
  };

  const cancelPendingFill = () => setPendingFill(null);

  return (
    <>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      {/* Message Logs removed per UX request */}

      <SectionCard title="Compose Sanction SMS" description="Create preview or queue sanction SMS messages.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="md:col-span-2">
            <label className="block">
              <span className="block text-sm font-medium mb-1">Phone(s) — single or multiple (comma/newline separated)</span>
              <input
                type="text"
                value={manualPhones}
                onChange={(e) => setManualPhones(e.target.value)}
                placeholder="09171234567 or 09171234567, 09919876543"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm w-full"
              />
              <div className="text-xs text-slate-500 mt-1">Enter one phone or multiple numbers separated by commas or newlines.</div>
            </label>
          </div>

          {/* Combined Student name / LRN input with live-search */}
          <div className="relative md:col-span-2">
            <input
              placeholder="Student name or LRN (type to search)"
              value={studentQuery}
              onChange={(e) => {
                setStudentQuery(e.target.value);
                setStudentName(e.target.value);
                setStudentId('');
              }}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm w-full"
            />
            {suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded border bg-white shadow">
                {suggestions.map((s) => {
                  const display = (s.fullName || `${s.firstName || ''} ${s.lastName || ''}`).trim();
                  const label = s.lrn ? `${display} (${s.lrn})` : display;
                  return (
                    <li key={s.id} className="border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => handleSelectSuggestion(s)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50"
                      >
                        {label}
                        <div className="text-xs text-slate-500">{s.sectionName || s.gradeLevel || ''}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {suggestionsLoading ? <div className="text-sm text-slate-500">Searching...</div> : null}
          </div>

          {pendingFill ? (
            <div className="md:col-span-2 rounded border p-3 bg-yellow-50">
              <div className="text-sm">The Manual phones field already has content. How would you like to proceed with the selected student's contact ({pendingFill.display})?</div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={applyReplaceManual} className="rounded bg-blue-600 px-3 py-1 text-white">Replace</button>
                <button type="button" onClick={applyAppendManual} className="rounded bg-gray-200 px-3 py-1">Append</button>
                <button type="button" onClick={cancelPendingFill} className="rounded bg-red-200 px-3 py-1">Cancel</button>
              </div>
            </div>
          ) : null}

          <input
            placeholder="Grade / Section"
            value={gradeSection}
            onChange={(e) => setGradeSection(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />

          <input
            placeholder="Violation"
            value={violation}
            onChange={(e) => setViolation(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />

          <input
            placeholder="Sanction"
            value={sanction}
            onChange={(e) => setSanction(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />

          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />

          <input placeholder="Teacher" value={teacher} onChange={(e) => setTeacher(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />

          <select value={violationType} onChange={(e) => setViolationType(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Violation Type (optional)</option>
            <option value="Minor">Minor</option>
            <option value="Major">Major</option>
            <option value="Severe">Severe</option>
          </select>

          <input placeholder="Optional extra text" value={optionalTextInput} onChange={(e) => setOptionalTextInput(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" />

          {/* Generate / Reset moved below input template */}
          <div className="ml-auto flex gap-2 md:col-span-2">
            <button type="button" onClick={generateMessage} disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
              Generate
            </button>
            <button type="button" onClick={resetAll} disabled={busy} className="rounded-xl bg-gray-300 px-4 py-2 text-sm font-semibold">
              Reset
            </button>
          </div>

          <label className="block md:col-span-2">
            <span className="block text-sm font-medium mb-1">Message</span>
            <textarea rows={6} maxLength={charLimit} value={messageText} onChange={(e) => setMessageText(e.target.value)} className="w-full border p-2 rounded" />
            <div className="text-sm text-gray-600 mt-1">{messageText.length}/{charLimit} chars</div>
          </label>

            <div className="flex gap-3 md:col-span-2 mt-2">
            <button type="button" onClick={handleSend} disabled={busy} className="bg-red-600 text-white px-4 py-2 rounded">
              {busy ? 'Sending...' : 'Send SMS'}
            </button>
            <button type="button" onClick={handlePreview} disabled={busy} className="bg-yellow-500 text-black px-4 py-2 rounded">
              {busy ? 'Working...' : 'Preview Only'}
            </button>
          </div>

          <div className="md:col-span-2">
            <h3 className="font-semibold mb-2">Preview</h3>
            <div className="border rounded p-3 min-h-[120px] bg-white whitespace-pre-wrap">{previewText || 'Message preview will appear here.'}</div>
          </div>

          <div className="md:col-span-2">
            <p className="text-sm text-slate-500">This is a one-way message and replies to this channel are not monitored. If you would like to receive a response, please include a valid Gmail address so the recipient can reply and you can view their message there.</p>
          </div>
        </form>
      </SectionCard>
    </>
  );
}
