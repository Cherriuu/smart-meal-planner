// Small helpers shared by the wizard steps.

// Anything that came from a user or the API must go through this before it is put into innerHTML.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

// Shrinks a photo before upload: longest side at most maxSide px, re-encoded as JPEG,
// and turned upright (phone photos often store rotation as metadata only), so Gemini's
// boxes match what the user sees. If anything goes wrong, the original file is returned.
export async function resizePhoto(file, maxSide = 1600, quality = 0.85) {
  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; // transparent PNG areas would turn black in a JPEG
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
    });
    const name = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
    const resized = new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
    if (import.meta.env.DEV) console.log(`[resize] ${file.name}: ${kb(file.size)} -> ${kb(resized.size)} (${width}x${height})`);
    return resized;
  } catch (error) {
    if (import.meta.env.DEV) console.warn(`[resize] ${file.name}: couldn't resize, sending the original`, error);
    return file;
  }
}

// An ingredient amount as people write it: 2 -> "2", 0.5 -> "½", 2.33 -> "2⅓", 1.2 -> "1.2".
// 0 or nothing gives '' so the amount is left out.
const FRACTIONS = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];

export function formatAmount(amount) {
  const value = Number(amount);
  if (!amount || !Number.isFinite(value) || value <= 0) return '';
  const whole = Math.floor(value);
  const rest = value - whole;
  // Close to a common fraction (0.333333 counts as ⅓)
  const fraction = FRACTIONS.find(([part]) => Math.abs(rest - part) <= 0.03);
  if (fraction) return `${whole || ''}${fraction[1]}`;
  // Otherwise one decimal, without a trailing ".0" (3.0 -> "3"); tiny amounts keep two decimals
  const rounded = Math.round(value * 10) / 10 || Math.round(value * 100) / 100;
  return rounded ? String(rounded) : '';
}

// A message a person can understand, for a failed request.
export function friendlyError(error) {
  if (error instanceof TypeError) {
    return "Can't reach the server. Make sure the backend is running, then try again.";
  }
  const message = error?.message;
  // api/client.js falls back to "Request failed: 500" when the backend sent no message of its own
  if (!message || /^Request failed: \d+$/.test(message)) return 'Something went wrong. Please try again.';
  return message;
}