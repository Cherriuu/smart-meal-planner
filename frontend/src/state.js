// Everything the user does in the wizard lives here, NOT inside a step's HTML.
// Steps are re-drawn every time you land on them, so they read from this state
// when they draw and write to it as the user types. That is why going Back and
// forth never loses anything.
//
// Preferences are the exception: they have their own saved copy in preferences.js.
// Photos stay in memory only (a File can't be stored in the browser), so a page
// refresh clears them.

const state = {
  files: [],          // photos the user picked
  detectedFor: null,  // which photos the ingredient list was last detected from
  ingredients: [],    // [{ name, checked, manual }] shown on the Review step
  removed: new Set(), // names the user deleted, so a re-detect doesn't bring them back
  recipes: null,      // last recipe results
  recipesFor: null,   // the request those results belong to
  swapsFor: null,     // the request whose recipes already have their smart swaps
};

export function getState() {
  return state;
}

// ---------- Photos ----------

function fileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

// Same photos in the same order give the same text. Used to know if we must detect again.
export function filesSignature(files) {
  return files.map(fileKey).join('\n');
}

export function addFiles(newFiles) {
  const known = new Set(state.files.map(fileKey));
  for (const file of newFiles) {
    if (!known.has(fileKey(file))) {
      state.files.push(file);
      known.add(fileKey(file));
    }
  }
}

export function removeFile(file) {
  state.files = state.files.filter((f) => f !== file);
}

// ---------- Ingredients ----------

export function normalizeName(name) {
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Called after photos are analysed. Keeps what the user already did:
// items they unchecked stay unchecked, items they deleted stay gone,
// and items they typed in stay on the list.
export function applyDetected(names, signature) {
  const previous = new Map(state.ingredients.map((item) => [item.name, item]));
  const detected = [];
  for (const raw of names) {
    const name = normalizeName(raw);
    if (name && !state.removed.has(name) && !detected.includes(name)) detected.push(name);
  }

  const fromPhotos = detected.map((name) => ({
    name,
    checked: previous.get(name)?.checked ?? true,
    manual: previous.get(name)?.manual ?? false,
  }));
  const typedIn = state.ingredients.filter((item) => item.manual && !detected.includes(item.name));

  state.ingredients = [...fromPhotos, ...typedIn];
  state.detectedFor = signature;
}

// Returns 'added', 'exists' or 'empty'.
export function addIngredient(raw) {
  const name = normalizeName(raw);
  if (!name) return 'empty';
  state.removed.delete(name);
  const existing = state.ingredients.find((item) => item.name === name);
  if (existing) {
    existing.checked = true;
    return 'exists';
  }
  state.ingredients.push({ name, checked: true, manual: true });
  return 'added';
}

export function removeIngredient(index) {
  const [item] = state.ingredients.splice(index, 1);
  if (item) state.removed.add(item.name);
}

export function checkedIngredients() {
  return state.ingredients.filter((item) => item.checked).map((item) => item.name);
}