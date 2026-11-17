// Small helpers shared by the wizard steps.
import mascotIdle from './assets/pixel/mascot.png';
import mascotBlink from './assets/pixel/mascot_blink.png';
import mascotHappy from './assets/pixel/mascot_happy.png';
import sparkle from './assets/pixel/sparkle.png';

export { mascotBlink };

// Simple line icons (24x24, drawn with the current text color). Only our own markup goes in here.
const ICON_PATHS = {
  check: '<path d="m5 12 5 5 9-10"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z"/><circle cx="12" cy="13" r="3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M12 3c2.5 3 4.5 5.4 4.5 8.5a4.5 4.5 0 0 1-9 0C7.5 9 9 7.5 9.5 6c.8 1.5 1.5 2.2 2.5 2.5C12 6.5 12 5 12 3Z"/>',
  person: '<path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="8" r="4"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
};

export function icon(name, size = 24, strokeWidth = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

// The mascot and its speech bubble at the top of every step. The h1 keeps id="step-title"
// and tabindex="-1" because the wizard moves focus to it. mood: 'idle' (blinks) or 'happy'.
export function helperHtml(title, line, mood = 'idle') {
  const src = mood === 'happy' ? mascotHappy : mascotIdle;
  return `
    <div class="helper">
      <div class="mascot" aria-hidden="true">
        <img class="pixel" src="${src}" data-mood="${mood}" width="96" height="96" alt="">
      </div>
      <div class="bubble">
        <div class="title-row">
          <h1 id="step-title" tabindex="-1">${escapeHtml(title)}</h1>
          <span class="stars" aria-hidden="true">
            <img class="star star--up pixel" src="${sparkle}" width="32" height="32" alt="">
            <img class="star star--down pixel" src="${sparkle}" width="32" height="32" alt="">
          </span>
        </div>
        <p>${escapeHtml(line)}</p>
      </div>
    </div>`;
}

// Makes an idle mascot blink (eyes shut for 140ms every ~3.3s). Returns a stop function
// for the step's unmount(). Does nothing for the happy mascot or when motion is reduced.
export function startBlink(root) {
  const img = root.querySelector('.mascot img');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!img || img.dataset.mood !== 'idle' || reduceMotion) return () => {};
  let reopen;
  const timer = setInterval(() => {
    img.src = mascotBlink;
    reopen = setTimeout(() => { img.src = mascotIdle; }, 140);
  }, 3300);
  return () => {
    clearInterval(timer);
    clearTimeout(reopen);
  };
}

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