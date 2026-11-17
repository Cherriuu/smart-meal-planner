// Step 4: recipes for the checked ingredients + the saved preferences.
import { getState, checkedIngredients } from '../state.js';
import { getPreferences } from '../preferences.js';
import { getRecipes, getSwaps } from '../api/client.js';
import { escapeHtml, friendlyError, formatAmount, helperHtml, icon } from '../util.js';

function buildRequest() {
  const prefs = getPreferences();
  return {
    ingredients: checkedIngredients(),
    appliances: prefs.appliances,
    servings: prefs.servings,
    occasion: prefs.occasion,
    maxCalories: prefs.maxCalories === '' ? null : prefs.maxCalories,
    highProtein: prefs.highProtein,
    lowSugar: prefs.lowSugar,
  };
}

// Inside of the "You'll also need" box: each missing food in bold, and a pink
// "use your spinach" tag after it when a smart swap arrived. Every name is escaped.
function needHtml(recipe) {
  const swaps = recipe.swaps ?? {};
  const items = recipe.missingIngredients.map((name) => {
    const swap = swaps[name]
      ? ` <span class="r-card__swap">${icon('swap', 12, 2.5)}<span class="visually-hidden">or </span>use your ${escapeHtml(swaps[name])}</span>`
      : '';
    return `<b>${escapeHtml(name)}</b>${swap}`;
  });
  return `You'll also need: ${items.join(', ')}`;
}

// The settings as short chips: "Holiday", "2 servings", "up to 2000 cal", "High protein"
function settingsParts(prefs) {
  return [
    prefs.occasion,
    `${prefs.servings} ${prefs.servings === 1 ? 'serving' : 'servings'}`,
    prefs.maxCalories !== '' ? `up to ${prefs.maxCalories} cal` : null,
    prefs.highProtein ? 'High protein' : null,
    prefs.lowSugar ? 'Low sugar' : null,
  ].filter(Boolean);
}

// Small ring chart for "4/6 in your fridge" (green when you have everything)
function ringSvg(have, total) {
  const circumference = 2 * Math.PI * 9;
  const share = total ? have / total : 1;
  const color = share === 1 ? '#2e8b57' : 'var(--color-primary)';
  return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-primary-soft)" stroke-width="3.5"/>
    <circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"
      stroke-dasharray="${circumference * share} ${circumference}"/>
  </svg>`;
}

// Ideas for when nothing matched, based on the current settings.
// (No appliances selected means "don't filter", so only 1-3 selected counts as "a few".)
function suggestionsFor(prefs) {
  const tips = [];
  if (prefs.highProtein) tips.push('Try turning off High protein');
  if (prefs.lowSugar) tips.push('Try turning off Low sugar');
  if (prefs.maxCalories !== '') tips.push('Try raising or removing your calorie limit');
  if (prefs.occasion !== 'Casual') tips.push('Try choosing Casual for more options');
  if (prefs.appliances.length > 0 && prefs.appliances.length <= 3) tips.push('Try selecting more appliances');
  tips.push('Or add more ingredients');
  return tips;
}

// ---------- Display-only clean-up of recipe text ----------

const URL_PATTERN = /https?:\/\/\S+/g;
const CHATTER = /\bI['’]ve\b|\bI['’]m\b| my |recipe is/i;

// Steps without links or blog chatter. If that would remove everything, keep all the
// steps (still without links). The list numbers itself, so it stays 1, 2, 3...
function displaySteps(steps) {
  const cleaned = steps.map((step) => ({
    text: step.replace(URL_PATTERN, '').replace(/\s{2,}/g, ' ').trim(),
    hadUrl: /https?:\/\//.test(step),
  }));
  const isChatter = ({ text, hadUrl }) =>
    (text.length > 350 && CHATTER.test(text)) || (hadUrl && text.length > 200);
  const kept = cleaned.filter((step) => step.text && !isChatter(step));
  return (kept.length ? kept : cleaned).map((step) => step.text).filter(Boolean);
}

// Words that only look plural
const NOT_PLURAL = new Set(['molasses', 'swiss']);

// One word made singular: "Tbsps" -> "Tbsp", "pinches" -> "pinch", "lemons" -> "lemon".
// Words ending in "ss", "us", "is" or "ous" ("hummus", "glass") are left alone.
function singular(word, { name = false } = {}) {
  const lower = word.toLowerCase();
  if (!lower.endsWith('s') || /(ss|us|is|ous)$/.test(lower) || NOT_PLURAL.has(lower)) return word;
  if (name && lower.endsWith('ies') && lower.length > 4) return `${word.slice(0, -3)}y`; // berries -> berry
  if (/(ches|shes|xes)$/.test(lower) || (name && lower.endsWith('oes'))) return word.slice(0, -2); // tomatoes -> tomato
  return word.slice(0, -1);
}

// "1 Tbsp butter", "½ cup milk", "salt and pepper" (no "2 servings ...")
function ingredientText({ amount, unit, name }) {
  if (/^servings?$/i.test(unit ?? '')) return name;
  const shown = formatAmount(amount);
  const oneOrLess = shown !== '' && (Number(amount) <= 1 || shown === '1'); // 1.02 shows as "1"
  let displayUnit = unit ?? '';
  let displayName = name;
  if (oneOrLess && displayUnit.length > 2) displayUnit = singular(displayUnit); // "oz", "g", "ml" stay
  if (oneOrLess && !displayUnit) {
    const words = displayName.split(' ');
    words[words.length - 1] = singular(words[words.length - 1], { name: true }); // only the last word
    displayName = words.join(' ');
  }
  return [shown, displayUnit, displayName].filter((part) => part !== '' && part != null).join(' ');
}

function recipeCard(recipe, index) {
  const missingNames = recipe.missingIngredients ?? [];
  const meta = [
    recipe.readyInMinutes != null ? `${icon('clock', 15)}${escapeHtml(recipe.readyInMinutes)} min` : null,
    recipe.calories != null ? `${icon('flame', 15)}${escapeHtml(recipe.calories)} cal / serving` : null,
    recipe.servings != null ? `${icon('person', 15)}${escapeHtml(recipe.servings)} servings` : null,
  ].filter(Boolean).map((part) => `<span>${part}</span>`).join('');

  // "X/Y in your fridge": Y = all ingredients, X = the ones not missing
  const total = recipe.ingredients.length;
  const have = Math.max(0, total - missingNames.length);
  const badge = total ? `<span class="r-card__have">${ringSvg(have, total)}${have}/${total} in your fridge</span>` : '';

  const need = missingNames.length
    ? `<div class="r-card__need" data-missing>${needHtml(recipe)}</div>`
    : '<div class="r-card__need r-card__need--all">You have everything for this one!</div>';

  const ingredients = recipe.ingredients
    .map((i) => {
      // Pink "missing" style is matched on the original name, not the tidied one
      return `<li${missingNames.includes(i.name) ? ' class="recipes__ing--missing"' : ''}>${escapeHtml(ingredientText(i))}</li>`;
    })
    .join('');
  const steps = displaySteps(recipe.steps).map((step) => `<li><span>${escapeHtml(step)}</span></li>`).join('');
  const equipment = (recipe.appliances ?? []).map((name) => `<li>${escapeHtml(name)}</li>`).join('');

  return `
    <article class="card r-card" data-recipe-id="${escapeHtml(recipe.id)}" style="animation-delay:${index * 60}ms">
      <div class="r-card__media">
        ${recipe.image ? `<img class="card__image" src="${escapeHtml(recipe.image)}" alt="">` : '<div class="card__image" aria-hidden="true"></div>'}
        ${badge}
      </div>
      <div class="card__body">
        <h2 class="recipes__title">${escapeHtml(recipe.title)}</h2>
        <p class="card__meta">${meta}</p>
        ${need}
        <details>
          <summary>Ingredients and steps</summary>
          <h3 class="recipes__subtitle">Ingredients</h3>
          <ul class="recipes__ings">${ingredients}</ul>
          <h3 class="recipes__subtitle">Steps</h3>
          <ol class="recipes__steps">${steps}</ol>
          ${equipment ? `<h3 class="recipes__subtitle">Equipment</h3><ul>${equipment}</ul>` : ''}
        </details>
      </div>
    </article>`;
}

export function mountRecipes(root) {
  const state = getState();
  let active = true; // false once the user leaves this step

  const settingChips = settingsParts(getPreferences())
    .map((part) => `<span class="chip">${escapeHtml(part)}</span>`)
    .join('');
  root.innerHTML = `
    ${helperHtml('Recipes', "Yay! Here's what you can make. Ones you have the most for are first.", 'happy')}
    <div class="recipes__settings" id="settings-summary">
      <span class="visually-hidden">Your settings:</span>
      ${settingChips}
      <button class="btn btn--secondary btn--small" type="button" data-edit-prefs>Edit preferences</button>
    </div>
    <div id="recipes-body" aria-live="polite"></div>
  `;
  const body = root.querySelector('#recipes-body');

  // Same as clicking "Preferences" in the step bar: the wizard listens for the URL change.
  // root is shared by every step, so unmount() removes this again.
  function onNavClick(event) {
    if (event.target.closest('[data-edit-prefs]')) location.hash = '#/preferences';
    else if (event.target.closest('[data-back-review]')) location.hash = '#/review';
  }
  root.addEventListener('click', onNavClick);

  function showResults(recipes) {
    if (recipes.length) {
      body.innerHTML = `<div class="grid recipes__grid">${recipes.map(recipeCard).join('')}</div>`;
      return;
    }
    const tips = suggestionsFor(getPreferences()).map((tip) => `<li>${escapeHtml(tip)}</li>`).join('');
    body.innerHTML = `
      <div class="stack">
        <p>No recipes match your ingredients and preferences.</p>
        <ul>${tips}</ul>
        <div class="row">
          <button class="btn" type="button" data-edit-prefs>Edit preferences</button>
          <button class="btn btn--secondary" type="button" data-back-review>Back to ingredients</button>
        </div>
      </div>`;
  }

  // Smart swaps arrive after the cards are shown. They're a bonus: if the call fails,
  // the cards just stay as they are. Saved on the recipes, so Back and forth reuses them.
  async function loadSwaps(request, key, recipes) {
    if (state.swapsFor === key) return; // already loaded, or still loading
    state.swapsFor = key;
    const needSwaps = recipes.filter((recipe) => recipe.missingIngredients?.length);
    if (!needSwaps.length) return;
    try {
      const { swaps } = await getSwaps(
        request.ingredients,
        needSwaps.map(({ id, title, missingIngredients }) => ({ id, title, missingIngredients })),
      );
      for (const recipe of needSwaps) recipe.swaps = swaps[recipe.id] ?? {};
    } catch {
      if (state.swapsFor === key) state.swapsFor = null; // try again on the next visit
      return;
    }
    // Only touch the lines that changed. Look them up on the page, not in this step's
    // old HTML, since the user may have gone Back and returned while swaps loaded.
    if (state.recipesFor !== key) return;
    for (const recipe of needSwaps) {
      if (!Object.keys(recipe.swaps).length) continue; // text unchanged, don't re-announce it
      const line = document.querySelector(`#recipes-body [data-recipe-id="${CSS.escape(String(recipe.id))}"] [data-missing]`);
      if (line) line.innerHTML = needHtml(recipe); // names are escaped inside needHtml
    }
  }

  async function load() {
    const request = buildRequest();
    const key = JSON.stringify(request);

    // Same ingredients and preferences as before: reuse the results.
    // (Every search costs the shared Spoonacular quota, and the list stays put.)
    if (state.recipesFor === key && state.recipes) {
      showResults(state.recipes);
      loadSwaps(request, key, state.recipes);
      return;
    }

    body.innerHTML = '<p><span class="spinner" role="status"><span class="visually-hidden">Loading recipes</span></span></p>';
    try {
      const { recipes } = await getRecipes(request);
      state.recipes = recipes;
      state.recipesFor = key;
      if (active) showResults(recipes);
      loadSwaps(request, key, recipes);
    } catch (err) {
      if (!active) return;
      body.innerHTML = `
        <div class="stack">
          <p class="field__error">${escapeHtml(friendlyError(err))}</p>
          <button class="btn" type="button" id="retry">Try again</button>
        </div>`;
      body.querySelector('#retry').addEventListener('click', load);
    }
  }

  load();

  return {
    unmount() {
      active = false;
      root.removeEventListener('click', onNavClick);
    },
  };
}