export function SuccessBanner({ message }) {
  if (!message) return null;

  return (
    <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {message}
    </div>
  );
}
