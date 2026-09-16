// Two bounded horizontal resamplings provide a review-only fallback for narrow
// printed numbers. They are correlated measurements, not extra majority votes.
export const ASPECT_FACTORS = Object.freeze([1.5, 2]);
export function aspectEligible(entry) {
  if (!entry || entry.recoveredMark) return false;
  const count = entry.glyphCount ?? 1;
  return ['value', 'blackvalue'].includes(entry.kind) &&
    Number.isInteger(count) && count >= 1 && count <= 3 &&
    Number.isFinite(entry.w) && Number.isFinite(entry.h) &&
    entry.w > 0 && entry.h > 0 && entry.w / entry.h < count * 0.6;
}

// Resample the complete padded sample, retaining all its pixels and border.
// The source canvas is never resized or painted over.
export function aspectSamples(source) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) ||
      source.width < 1 || source.width > 512 || source.height < 1 || source.height > 256)
    return [];
  return ASPECT_FACTORS.map((factor) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(source.width * factor);
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { factor, png: canvas.toDataURL('image/png') };
  });
}

export function applyAspectReading(entry, reads) {
  if (!aspectEligible(entry) || entry.confidence >= 85) return;
  const proposals = reads.filter((r) => r.kind === 'aspect');
  // Duplicates cannot masquerade as measurements at two different scales.
  if (proposals.length !== 2 || ASPECT_FACTORS.some((factor) =>
      proposals.filter((r) => r.factor === factor).length !== 1)) return;
  if (proposals.some((r) => !Number.isFinite(r.confidence) || r.confidence < 75 || r.confidence > 100)) return;
  const [a, b] = proposals;
  const count = entry.glyphCount ?? 1;
  if (typeof a.text !== 'string' || !/^\d{1,3}$/.test(a.text) || a.text !== b.text ||
      a.text.length < count || a.text === entry.text) return;
  // Do not replace an existing full-length reading with a shorter/longer one.
  // Only a geometrically established truncation permits a length change.
  if (/^\d{1,3}$/.test(entry.text) && entry.text.length >= count &&
      a.text.length !== entry.text.length) return;
  if (reads.some((r) => r.kind !== 'aspect' && r.kind !== 'segments' &&
      /^\d{1,3}$/.test(r.text) && r.text.length > a.text.length)) return;
  entry.text = a.text;
  entry.confidence = 0;
  entry.aspectRecovered = true;
}
