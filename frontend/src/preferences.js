// Preferences page (issue #8)
// Users tell us what appliances they have and what they want.
// Choices are saved in the browser, so they are still there after a refresh.

import './preferences.css';
import ovenIcon from './assets/pixel/oven.png';
import microwaveIcon from './assets/pixel/microwave.png';
import airFryerIcon from './assets/pixel/air_fryer.png';
import stovetopIcon from './assets/pixel/stovetop.png';
import toasterIcon from './assets/pixel/toaster.png';
import { helperHtml } from './util.js';

const STORAGE_KEY = 'smartMealPlanner.preferences';

const APPLIANCES = ['Oven', 'Microwave', 'Air fryer', 'Stovetop', 'Toaster'];
const APPLIANCE_ICONS = {
  Oven: ovenIcon,
  Microwave: microwaveIcon,
  'Air fryer': airFryerIcon,
  Stovetop: stovetopIcon,
  Toaster: toasterIcon,
};
const OCCASIONS = ['Casual', 'Family dinner', 'Birthday', 'Potluck', 'Holiday'];
const OCCASION_NOTES = {
  Casual: 'Everyday cooking',
  'Family dinner': 'Feeds everyone',
  Birthday: 'Something special',
  Potluck: 'Easy to share',
  Holiday: 'Big and cozy',
};
// Quick picks under "Max calories" ('' = no limit)
const CALORIE_CHOICES = ['', 500, 800, 1200];

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

// True once the user has saved their preferences at least once.
export function hasSavedPreferences() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
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

// Options (used by the wizard):
//   embedded: true  -> no <main> wrapper and no Save button (the wizard's Next button saves)
//   onSubmit        -> called after a successful save when the user presses Enter in a field
// Returns { save }, where save() validates, stores, and returns true when everything is fine.
export function renderPreferences(root, { embedded = false, onSubmit } = {}) {
  const prefs = getPreferences();

  // Appliance tiles: pixel icon, then a round check and the name. The real checkbox
  // is inside the label, so FormData in save() still finds every checked appliance.
  const applianceTiles = APPLIANCES.map(
    (name) => `
      <label class="tile">
        <img class="tile__icon pixel" src="${APPLIANCE_ICONS[name]}" width="48" height="48" alt="">
        <span class="tile__row">
          <input class="check__input" type="checkbox" name="appliance" value="${name}"
            ${prefs.appliances.includes(name) ? 'checked' : ''}>
          <span class="check__box check__box--round" aria-hidden="true"></span>
          <span>${name}</span>
        </span>
      </label>`
  ).join('');

  // Occasion tiles are radio buttons with the same name, so form.elements.occasion.value still works.
  // One is always checked (like the old <select>), even if an old saved value isn't in the list.
  const occasion = OCCASIONS.includes(prefs.occasion) ? prefs.occasion : DEFAULTS.occasion;
  const occasionTiles = OCCASIONS.map(
    (name) => `
      <label class="tile">
        <span class="tile__row">
          <input class="check__input" type="radio" name="occasion" value="${name}"
            ${name === occasion ? 'checked' : ''}>
          <span class="check__box check__box--round" aria-hidden="true"></span>
          <span>${name}<small class="tile__note">${OCCASION_NOTES[name]}</small></span>
        </span>
      </label>`
  ).join('');

  const calorieChips = CALORIE_CHOICES.map(
    (value) => `<button class="prefs__chip" type="button" data-calories="${value}"
      aria-pressed="${String(prefs.maxCalories) === String(value)}">${value ? `${value} cal` : 'No limit'}</button>`
  ).join('');

  const healthPill = (name, label) => `
    <label class="pill">
      <input class="check__input" type="checkbox" name="${name}" ${prefs[name] ? 'checked' : ''}>
      <span class="check__box check__box--round" aria-hidden="true"></span>
      <span>${label}</span>
    </label>`;

  const content = `
      ${helperHtml('Your preferences', "Tell me what you can cook with and who you're cooking for.")}

      <form class="prefs" id="prefs-form" novalidate>
        <section class="card section" aria-labelledby="prefs-appliances">
          <h2 class="section-title" id="prefs-appliances"><span class="badge-n" aria-hidden="true">1</span>Appliances</h2>
          <p class="text-soft">Pick everything you can cook with.</p>
          <div class="tiles">${applianceTiles}</div>
        </section>

        <section class="card section" aria-labelledby="prefs-occasion">
          <h2 class="section-title" id="prefs-occasion"><span class="badge-n" aria-hidden="true">2</span>Occasion</h2>
          <p class="text-soft" id="occasion-hint">What are you cooking for?</p>
          <div class="tiles" role="radiogroup" aria-labelledby="prefs-occasion" aria-describedby="occasion-hint">${occasionTiles}</div>
        </section>

        <div class="two">
          <section class="card section" aria-labelledby="prefs-limits">
            <h2 class="section-title" id="prefs-limits"><span class="badge-n" aria-hidden="true">3</span>Limits</h2>
            <div class="field prefs__field">
              <label class="field__label" for="maxCalories">Max calories <span class="field__label-soft">per serving</span></label>
              <input class="input" id="maxCalories" name="maxCalories" type="number"
                inputmode="numeric" min="${LIMITS.calories.min}" max="${LIMITS.calories.max}"
                placeholder="No limit" value="${prefs.maxCalories}"
                aria-describedby="maxCalories-hint maxCalories-error">
              <div class="prefs__chips" role="group" aria-label="Quick calorie limits">${calorieChips}</div>
              <p class="text-soft" id="maxCalories-hint">Counted for one serving, not the whole recipe.</p>
              <p class="field__error" id="maxCalories-error" aria-live="polite"></p>
            </div>

            <div class="field prefs__field">
              <label class="field__label" for="servings">Number of servings</label>
              <div class="prefs__servings">
                <button class="prefs__step" type="button" data-servings-step="-1" aria-label="Fewer servings">−</button>
                <input class="input prefs__servings-input" id="servings" name="servings" type="number"
                  inputmode="numeric" min="${LIMITS.servings.min}" max="${LIMITS.servings.max}"
                  value="${prefs.servings}" aria-describedby="servings-error">
                <button class="prefs__step" type="button" data-servings-step="1" aria-label="More servings">+</button>
              </div>
              <p class="field__error" id="servings-error" aria-live="polite"></p>
            </div>
          </section>

          <section class="card section" aria-labelledby="prefs-health">
            <h2 class="section-title" id="prefs-health"><span class="badge-n" aria-hidden="true">4</span>Healthy options</h2>
            <p class="text-soft">Optional. We'll only show recipes that fit.</p>
            <div class="pills">
              ${healthPill('highProtein', 'High-protein')}
              ${healthPill('lowSugar', 'Low-sugar')}
            </div>
          </section>
        </div>

        <div class="row">
          ${embedded ? '' : '<button class="btn" type="submit">Save preferences</button>'}
          <p class="text-soft" id="prefs-status" role="status"></p>
        </div>
      </form>
  `;
  root.innerHTML = embedded ? content : `<main class="page stack--lg">${content}</main>`;

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

  // Light up the quick-pick chip that matches what's typed
  const chips = root.querySelectorAll('[data-calories]');
  function syncCalorieChips() {
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.calories === calories.value));
  }

  calories.addEventListener('input', () => {
    validate(calories, LIMITS.calories, false);
    syncCalorieChips();
  });
  servings.addEventListener('input', () => validate(servings, LIMITS.servings, true));
  form.addEventListener('input', () => {
    status.textContent = '';
  });

  // Quick picks fill the calorie box, then check it like typing would
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      calories.value = chip.dataset.calories;
      validate(calories, LIMITS.calories, false);
      syncCalorieChips();
      status.textContent = '';
    });
  }

  // − and + change servings by one, kept between 1 and 20
  for (const button of root.querySelectorAll('[data-servings-step]')) {
    button.addEventListener('click', () => {
      const { min, max } = LIMITS.servings;
      const current = Number.isInteger(Number(servings.value)) && servings.value !== '' ? Number(servings.value) : DEFAULTS.servings;
      servings.value = Math.min(max, Math.max(min, current + Number(button.dataset.servingsStep)));
      validate(servings, LIMITS.servings, true);
      status.textContent = '';
    });
  }

  // Validates, then stores the choices. Returns true when they were saved.
  function save() {
    // Check again on save, in case a bad value was pasted in.
    const caloriesOk = validate(calories, LIMITS.calories, false);
    const servingsOk = validate(servings, LIMITS.servings, true);
    if (!caloriesOk || !servingsOk) {
      (caloriesOk ? servings : calories).focus();
      return false;
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
      status.textContent = embedded ? '' : 'Preferences saved.';
      return true;
    } catch {
      status.textContent = "Couldn't save your preferences. Try again.";
      return false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (save() && onSubmit) onSubmit();
  });

  return { save };
}