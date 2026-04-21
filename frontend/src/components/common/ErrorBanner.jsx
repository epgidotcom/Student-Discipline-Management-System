export function ErrorBanner({ message }) {
  if (!message) return null;

  return (
    <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </div>
  );
}
