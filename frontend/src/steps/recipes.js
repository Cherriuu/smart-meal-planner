// Step 4: recipes for the checked ingredients + the saved preferences.
import { getState, checkedIngredients } from '../state.js';
import { getPreferences } from '../preferences.js';
import { getRecipes, getSwaps } from '../api/client.js';
import { escapeHtml, friendlyError } from '../util.js';

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

// "You'll also need: basil (or use your spinach), feta cheese" as plain text ('' if nothing's missing)
function missingText(recipe) {
  if (!recipe.missingIngredients?.length) return '';
  const swaps = recipe.swaps ?? {};
  const items = recipe.missingIngredients.map((name) => (swaps[name] ? `${name} (or use your ${swaps[name]})` : name));
  return `You'll also need: ${items.join(', ')}`;
}

function recipeCard(recipe) {
  const meta = [
    recipe.readyInMinutes != null ? `${recipe.readyInMinutes} min` : null,
    recipe.calories != null ? `${recipe.calories} cal` : null,
    recipe.servings != null ? `${recipe.servings} servings` : null,
  ].filter(Boolean).join(' · ');
  const missing = missingText(recipe)
    ? `<p class="text-soft" data-missing>${escapeHtml(missingText(recipe))}</p>`
    : '';

  const ingredients = recipe.ingredients
    .map((i) => `<li>${escapeHtml([i.amount, i.unit, i.name].filter((part) => part !== '' && part != null).join(' '))}</li>`)
    .join('');
  const steps = recipe.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');

  return `
    <article class="card" data-recipe-id="${escapeHtml(recipe.id)}">
      ${recipe.image ? `<img class="card__image" src="${escapeHtml(recipe.image)}" alt="">` : ''}
      <div class="card__body">
        <h2 class="recipes__title">${escapeHtml(recipe.title)}</h2>
        <p class="card__meta">${escapeHtml(meta)}</p>
        ${missing}
        <details>
          <summary>Ingredients and steps</summary>
          <h3 class="recipes__subtitle">Ingredients</h3>
          <ul>${ingredients}</ul>
          <h3 class="recipes__subtitle">Steps</h3>
          <ol>${steps}</ol>
        </details>
      </div>
    </article>`;
}

export function mountRecipes(root) {
  const state = getState();
  let active = true; // false once the user leaves this step

  root.innerHTML = `
    <h1 id="step-title" tabindex="-1">Recipes</h1>
    <div id="recipes-body" aria-live="polite"></div>
  `;
  const body = root.querySelector('#recipes-body');

  function showResults(recipes) {
    body.innerHTML = recipes.length
      ? `<div class="grid">${recipes.map(recipeCard).join('')}</div>`
      : '<p>No recipes match your ingredients and preferences. Go back to change them.</p>';
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
      if (line) line.textContent = missingText(recipe);
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
    },
  };
}