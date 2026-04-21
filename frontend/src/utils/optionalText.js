export function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}
