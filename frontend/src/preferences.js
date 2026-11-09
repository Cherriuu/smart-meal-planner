// Preferences page (issue #8)
// Users tell us what appliances they have and what they want.
// Choices are saved in the browser, so they are still there after a refresh.

import './preferences.css';

const STORAGE_KEY = 'smartMealPlanner.preferences';

const APPLIANCES = ['Oven', 'Microwave', 'Air fryer', 'Stovetop', 'Toaster'];
const OCCASIONS = ['Casual', 'Family dinner', 'Birthday', 'Potluck', 'Holiday'];

// Allowed ranges. Anything outside is an "impossible value" and is blocked.
const LIMITS = {
  calories: { label: 'Max calories', min: 1, max: 5000 },
  servings: { label: 'Servings', min: 1, max: 20 },
};

const DEFAULTS = {
  appliances: [],
  maxCalories: '', // empty means no limit
  highProtein: false,
  lowSugar: false,
  servings: 2,
  occasion: 'Casual',
};

// Other pages (like the recipe list) can call this to read the saved choices.
export function getPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

// Returns an error message, or '' when the value is fine.
function checkNumber(input, { label, min, max }, required) {
  if (input.validity.badInput) return `${label} must be a number.`;
  if (input.value === '') return required ? `${label} is required.` : '';
  const n = Number(input.value);
  if (!Number.isInteger(n)) return `${label} must be a whole number.`;
  if (n < min) return `${label} can't be less than ${min}.`;
  if (n > max) return `${label} can't be more than ${max}.`;
  return '';
}

export function renderPreferences(root) {
  const prefs = getPreferences();

  const appliancePills = APPLIANCES.map(
    (name) => `
      <div class="pill-row">
        <label class="check">
          <input class="check__input" type="checkbox" name="appliance" value="${name}"
            ${prefs.appliances.includes(name) ? 'checked' : ''}>
          <span class="check__box" aria-hidden="true"></span>
          <span class="check__label">${name}</span>
        </label>
      </div>`
  ).join('');

  const occasionOptions = OCCASIONS.map(
    (name) => `<option ${name === prefs.occasion ? 'selected' : ''}>${name}</option>`
  ).join('');

  root.innerHTML = `
    <main class="page stack--lg">
      <h1>Your preferences</h1>

      <form class="prefs" id="prefs-form" novalidate>
        <section class="prefs__section">
          <h2 class="prefs__title">Appliances</h2>
          <p class="text-soft">Pick everything you can cook with.</p>
          <div class="prefs__grid">${appliancePills}</div>
        </section>

        <section class="prefs__section">
          <h2 class="prefs__title">Limits</h2>
          <div class="field">
            <label class="field__label" for="maxCalories">Max calories</label>
            <input class="input" id="maxCalories" name="maxCalories" type="number"
              inputmode="numeric" min="${LIMITS.calories.min}" max="${LIMITS.calories.max}"
              placeholder="No limit" value="${prefs.maxCalories}"
              aria-describedby="maxCalories-error">
            <p class="field__error" id="maxCalories-error" aria-live="polite"></p>
          </div>

          <div class="field">
            <label class="field__label" for="servings">Number of servings</label>
            <input class="input" id="servings" name="servings" type="number"
              inputmode="numeric" min="${LIMITS.servings.min}" max="${LIMITS.servings.max}"
              value="${prefs.servings}" aria-describedby="servings-error">
            <p class="field__error" id="servings-error" aria-live="polite"></p>
          </div>
        </section>

        <section class="prefs__section">
          <h2 class="prefs__title">Healthy options</h2>
          <div class="prefs__grid">
            <div class="pill-row">
              <label class="check">
                <input class="check__input" type="checkbox" name="highProtein"
                  ${prefs.highProtein ? 'checked' : ''}>
                <span class="check__box" aria-hidden="true"></span>
                <span class="check__label">High-protein</span>
              </label>
            </div>
            <div class="pill-row">
              <label class="check">
                <input class="check__input" type="checkbox" name="lowSugar"
                  ${prefs.lowSugar ? 'checked' : ''}>
                <span class="check__box" aria-hidden="true"></span>
                <span class="check__label">Low-sugar</span>
              </label>
            </div>
          </div>
        </section>

        <section class="prefs__section">
          <h2 class="prefs__title">Occasion</h2>
          <div class="field">
            <label class="field__label" for="occasion">What are you cooking for?</label>
            <select class="input" id="occasion" name="occasion">${occasionOptions}</select>
          </div>
        </section>

        <div class="row">
          <button class="btn" type="submit">Save preferences</button>
          <p class="text-soft" id="prefs-status" role="status"></p>
        </div>
      </form>
    </main>
  `;

  const form = root.querySelector('#prefs-form');
  const calories = form.elements.maxCalories;
  const servings = form.elements.servings;
  const status = root.querySelector('#prefs-status');

  // Shows or clears the error under a field. Returns true when the value is fine.
  function validate(input, rules, required) {
    const message = checkNumber(input, rules, required);
    root.querySelector(`#${input.id}-error`).textContent = message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
  }

  // Block keys that make no sense in a whole, positive number (like the minus sign).
  for (const input of [calories, servings]) {
    input.addEventListener('keydown', (event) => {
      if (['-', '+', 'e', 'E', '.', ','].includes(event.key)) event.preventDefault();
    });
  }

  calories.addEventListener('input', () => validate(calories, LIMITS.calories, false));
  servings.addEventListener('input', () => validate(servings, LIMITS.servings, true));
  form.addEventListener('input', () => {
    status.textContent = '';
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    // Check again on save, in case a bad value was pasted in.
    const caloriesOk = validate(calories, LIMITS.calories, false);
    const servingsOk = validate(servings, LIMITS.servings, true);
    if (!caloriesOk || !servingsOk) {
      (caloriesOk ? servings : calories).focus();
      return;
    }

    const saved = {
      appliances: new FormData(form).getAll('appliance'),
      maxCalories: calories.value === '' ? '' : Number(calories.value),
      highProtein: form.elements.highProtein.checked,
      lowSugar: form.elements.lowSugar.checked,
      servings: Number(servings.value),
      occasion: form.elements.occasion.value,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      status.textContent = 'Preferences saved.';
    } catch {
      status.textContent = "Couldn't save your preferences. Try again.";
    }
  });
}
