import { useEffect, useState } from 'react';
import { ErrorBanner } from '../../components/common/ErrorBanner.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { apiRequest } from '../../services/api.js';

export function SettingsPage() {
  const [sanctions, setSanctions] = useState([]);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [sanctionsData, sectionsData] = await Promise.all([
          apiRequest('/settings/sanctions'),
          apiRequest('/settings/sections')
        ]);

        if (!cancelled) {
          setSanctions(Array.isArray(sanctionsData) ? sanctionsData : []);
          setSections(Array.isArray(sectionsData) ? sectionsData : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load settings');
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <ErrorBanner message={error} />
      <SectionCard title="Sanctions" description="Reference table used by violations and SMS workflows.">
        <div className="grid gap-3 sm:grid-cols-2">
          {sanctions.map((sanction) => (
            <article key={sanction.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">{sanction.code}</p>
              <p className="text-slate-600">{sanction.label}</p>
              <p className="text-xs text-slate-500">{sanction.description || 'No description'}</p>
            </article>
          ))}
          {!sanctions.length ? <p className="text-sm text-slate-500">No sanctions configured.</p> : null}
        </div>
      </SectionCard>

      <SectionCard title="Sections" description="Normalized grade, program/strand, and section records used by student enrollment.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">Grade</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Program / Strand</th>
                <th className="py-2 pr-3">Section</th>
                <th className="py-2">Adviser</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr key={section.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{section.gradeLevel}</td>
                  <td className="py-2 pr-3">{section.programType ? section.programType.replace(/_/g, ' ') : '-'}</td>
                  <td className="py-2 pr-3">{section.programName || section.strand || '-'}</td>
                  <td className="py-2 pr-3">{section.sectionName}</td>
                  <td className="py-2">{section.adviser || '-'}</td>
                </tr>
              ))}
              {!sections.length ? (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-500">
                    No sections configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}
