// Step 3: the user approves (or fixes) the detected ingredients before any recipe search.
import { getState, addIngredient, removeIngredient } from '../state.js';
import { escapeHtml } from '../util.js';

export function mountReview(root) {
  const state = getState();

  root.innerHTML = `
    <h1 id="step-title" tabindex="-1">Review ingredients</h1>
    <p class="text-soft">Uncheck or remove anything that's wrong, and add what we missed. Only checked ingredients are used to find recipes.</p>
    <form class="review__add" id="add-form" novalidate>
      <div class="field">
        <label class="field__label" for="new-ingredient">Add an ingredient</label>
        <div class="row">
          <input class="input review__input" id="new-ingredient" type="text" maxlength="60"
            placeholder="Type an ingredient" autocomplete="off" aria-describedby="add-message">
          <button class="btn" type="submit">Add</button>
        </div>
        <p class="field__error" id="add-message" aria-live="polite"></p>
      </div>
    </form>
    <div id="ingredient-list"></div>
    <p class="field__error" id="review-error" role="alert"></p>
  `;

  const list = root.querySelector('#ingredient-list');
  const addInput = root.querySelector('#new-ingredient');
  const addMessage = root.querySelector('#add-message');
  const error = root.querySelector('#review-error');

  function renderList() {
    if (state.ingredients.length === 0) {
      list.innerHTML = '<p class="text-soft">No ingredients yet. Add some above.</p>';
      return;
    }
    list.innerHTML = state.ingredients
      .map(
        (item, index) => `
        <div class="pill-row">
          <label class="check">
            <input class="check__input" type="checkbox" data-index="${index}" ${item.checked ? 'checked' : ''}>
            <span class="check__box" aria-hidden="true"></span>
            <span class="check__label">${escapeHtml(item.name)}</span>
          </label>
          <button class="btn btn--ghost btn--small" type="button" data-remove="${index}"
            aria-label="Remove ${escapeHtml(item.name)}">Remove</button>
        </div>`
      )
      .join('');
  }

  list.addEventListener('change', (event) => {
    const box = event.target.closest('[data-index]');
    if (!box) return;
    state.ingredients[Number(box.dataset.index)].checked = box.checked;
    error.textContent = '';
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    removeIngredient(Number(button.dataset.remove));
    error.textContent = '';
    renderList();
    addInput.focus();
  });

  root.querySelector('#add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const typed = addInput.value;
    const result = addIngredient(typed);
    if (result === 'empty') {
      addMessage.textContent = 'Type an ingredient first.';
      return;
    }
    addMessage.textContent = result === 'exists' ? `"${typed.trim()}" is already on your list.` : '';
    error.textContent = '';
    addInput.value = '';
    renderList();
    addInput.focus();
  });

  renderList();

  return {
    beforeNext() {
      if (!state.ingredients.some((item) => item.checked)) {
        error.textContent = 'Check at least one ingredient to find recipes.';
        return false;
      }
      return true;
    },
  };
}