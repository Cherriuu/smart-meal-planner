// Step 3: the user approves (or fixes) the detected ingredients before any recipe search.
import { getState, addIngredient, removeIngredient } from '../state.js';
import { escapeHtml, helperHtml, icon } from '../util.js';

export function mountReview(root) {
  const state = getState();

  root.innerHTML = `
    ${helperHtml('Review ingredients', "Here's what I found! Uncheck anything I got wrong, and add what I missed.", 'happy')}
    <div class="review">
      <div class="card section review__photos-card" id="photo-boxes"></div>
      <div class="card section">
        <h2 class="section-title">Your ingredients <span class="chip review__count" id="checked-count"></span></h2>
        <p class="text-soft">Only checked ingredients are used to find recipes.</p>
        <div class="ing-list" id="ingredient-list"></div>
        <form class="review__add" id="add-form" novalidate>
          <label class="visually-hidden" for="new-ingredient">Add an ingredient</label>
          <input class="input review__input" id="new-ingredient" type="text" maxlength="60"
            placeholder="Type an ingredient" autocomplete="off" aria-describedby="add-message">
          <button class="btn" type="submit">Add</button>
        </form>
        <p class="field__error" id="add-message" aria-live="polite"></p>
        <p class="field__error" id="review-error" role="alert"></p>
      </div>
    </div>
  `;

  const list = root.querySelector('#ingredient-list');
  const photos = root.querySelector('#photo-boxes');
  const count = root.querySelector('#checked-count');
  const addInput = root.querySelector('#new-ingredient');
  const addMessage = root.querySelector('#add-message');
  const error = root.querySelector('#review-error');
  // Draw boxes on the exact (resized, upright) images Gemini saw, so they line up.
  // After "Add foods by hand" there are none, and the card says so instead.
  const shownPhotos = state.detectedPhotos.length
    ? state.detectedPhotos
    : state.detections.length ? state.files : [];
  const photoUrls = shownPhotos.map((file) => URL.createObjectURL(file));
  let firstDraw = true; // boxes pop in one after another only the first time

  function updateCount() {
    count.textContent = `${state.ingredients.filter((item) => item.checked).length} checked`;
  }

  // Each photo with a button over every detected food. Boxes are on a 0-1000 scale,
  // so dividing by 10 gives percentages that scale with the photo.
  function renderPhotos() {
    if (!photoUrls.length) {
      photos.innerHTML = `
        <div class="review__no-photo">
          ${icon('plus', 28)}
          <p>No photo this time. Type your foods in the list.</p>
        </div>`;
      return;
    }
    const byName = new Map(state.ingredients.map((item) => [item.name, item]));
    let order = 0;
    const figures = photoUrls
      .map((url, index) => {
        const boxes = state.detections
          .filter((item) => item.photo === index && byName.has(item.name))
          .map(({ name, box }) => {
            const [ymin, xmin, ymax, xmax] = box.map(Number);
            const delay = firstDraw ? `;animation-delay:${order++ * 120}ms` : '';
            const style = `left:${xmin / 10}%;top:${ymin / 10}%;width:${(xmax - xmin) / 10}%;height:${(ymax - ymin) / 10}%${delay}`;
            return `
              <button class="photo-box${firstDraw ? ' photo-box--pop' : ''}" type="button" data-name="${escapeHtml(name)}" style="${style}"
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
      .join('');
    const hint = state.detections.length ? '<p class="text-soft review__hint">Tap a box to check or uncheck it.</p>' : '';
    photos.innerHTML = `<div class="review__photos">${figures}</div>${hint}`;
    firstDraw = false;
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
    updateCount();
    error.textContent = '';
  });

  // Each ingredient is a chip: round check, name, "added" tag for typed-in foods, remove button
  function renderList() {
    updateCount();
    if (state.ingredients.length === 0) {
      list.innerHTML = state.noneFound
        ? `<p class="text-soft">We didn't spot any food in your photos. Add what you have below.</p>`
        : '<p class="text-soft">No ingredients yet. Add some below.</p>';
      return;
    }
    list.innerHTML = state.ingredients
      .map(
        (item, index) => `
        <div class="ing">
          <label class="ing__label">
            <input class="check__input" type="checkbox" data-index="${index}" ${item.checked ? 'checked' : ''}>
            <span class="check__box check__box--round" aria-hidden="true"></span>
            <span class="ing__name">${escapeHtml(item.name)}</span>
            ${item.manual ? '<span class="ing__tag">added</span>' : ''}
          </label>
          <button class="icon-btn" type="button" data-remove="${index}"
            aria-label="Remove ${escapeHtml(item.name)}">${icon('close', 14, 2.5)}</button>
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
    updateCount();
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
