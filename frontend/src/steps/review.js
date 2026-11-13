// Step 3: the user approves (or fixes) the detected ingredients before any recipe search.
import { getState, addIngredient, removeIngredient } from '../state.js';
import { escapeHtml } from '../util.js';

export function mountReview(root) {
  const state = getState();

  root.innerHTML = `
    <h1 id="step-title" tabindex="-1">Review ingredients</h1>
    <p class="text-soft">Uncheck or remove anything that's wrong, and add what we missed. Only checked ingredients are used to find recipes.</p>
    <div id="photo-boxes"></div>
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
  const photos = root.querySelector('#photo-boxes');
  const addInput = root.querySelector('#new-ingredient');
  const addMessage = root.querySelector('#add-message');
  const error = root.querySelector('#review-error');
  const photoUrls = state.detections.length ? state.files.map((file) => URL.createObjectURL(file)) : [];

  // Each photo with a button over every detected food. Boxes are on a 0-1000 scale,
  // so dividing by 10 gives percentages that scale with the photo.
  function renderPhotos() {
    if (!state.detections.length) {
      photos.innerHTML = '';
      return;
    }
    const byName = new Map(state.ingredients.map((item) => [item.name, item]));
    photos.innerHTML = `<div class="review__photos">${photoUrls
      .map((url, index) => {
        const boxes = state.detections
          .filter((item) => item.photo === index && byName.has(item.name))
          .map(({ name, box }) => {
            const [ymin, xmin, ymax, xmax] = box.map(Number);
            const style = `left:${xmin / 10}%;top:${ymin / 10}%;width:${(xmax - xmin) / 10}%;height:${(ymax - ymin) / 10}%`;
            return `
              <button class="photo-box" type="button" data-name="${escapeHtml(name)}" style="${style}"
                aria-pressed="${byName.get(name).checked}" aria-label="${escapeHtml(name)}">
                <span class="photo-box__label" aria-hidden="true">${escapeHtml(name)}</span>
              </button>`;
          })
          .join('');
        return `
          <figure class="review__photo">
            <div class="photo-boxes">
              <img src="${escapeHtml(url)}" alt="Photo ${index + 1} of ${photoUrls.length}">
              ${boxes}
            </div>
          </figure>`;
      })
      .join('')}</div>`;
  }

  // Keep every box for this food in step with its checkbox (no re-render, so focus stays put)
  function syncBoxes(name) {
    const item = state.ingredients.find((ingredient) => ingredient.name === name);
    for (const button of photos.querySelectorAll('.photo-box')) {
      if (button.dataset.name === name) button.setAttribute('aria-pressed', String(Boolean(item?.checked)));
    }
  }

  photos.addEventListener('click', (event) => {
    const button = event.target.closest('.photo-box');
    if (!button) return;
    const index = state.ingredients.findIndex((item) => item.name === button.dataset.name);
    if (index === -1) return;
    const item = state.ingredients[index];
    item.checked = !item.checked;
    const checkbox = list.querySelector(`[data-index="${index}"]`);
    if (checkbox) checkbox.checked = item.checked;
    syncBoxes(item.name);
    error.textContent = '';
  });

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
    const item = state.ingredients[Number(box.dataset.index)];
    item.checked = box.checked;
    syncBoxes(item.name);
    error.textContent = '';
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    removeIngredient(Number(button.dataset.remove));
    error.textContent = '';
    renderList();
    renderPhotos(); // its boxes go away too
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
    renderPhotos(); // adding back a removed food brings back its boxes
    addInput.focus();
  });

  renderPhotos();
  renderList();

  return {
    unmount() {
      for (const url of photoUrls) URL.revokeObjectURL(url);
    },
    beforeNext() {
      if (!state.ingredients.some((item) => item.checked)) {
        error.textContent = 'Check at least one ingredient to find recipes.';
        return false;
      }
      return true;
    },
  };
}