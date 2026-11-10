// Step 2: pick photos. Pressing Next sends them to the backend to find ingredients.
import { addFiles, removeFile, getState, filesSignature, applyDetected } from '../state.js';
import { detectIngredients } from '../api/client.js';
import { escapeHtml, friendlyError } from '../util.js';

export function mountUpload(root) {
  const state = getState();
  const previewUrls = new Map(); // File -> temporary URL for its thumbnail

  root.innerHTML = `
    <h1 id="step-title" tabindex="-1">Upload photos</h1>
    <p class="text-soft">Add photos of your fridge, pantry or groceries. We'll find the ingredients so you can check them on the next step.</p>
    <div class="stack">
      <div>
        <input class="visually-hidden upload__input" id="photos" type="file" accept="image/*" multiple>
        <label class="btn btn--secondary" for="photos">Choose photos</label>
      </div>
      <p class="field__error" id="upload-error" role="alert"></p>
      <ul class="upload__list" id="upload-list"></ul>
    </div>
  `;

  const input = root.querySelector('#photos');
  const list = root.querySelector('#upload-list');
  const error = root.querySelector('#upload-error');

  function previewUrl(file) {
    if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file));
    return previewUrls.get(file);
  }

  function renderList() {
    list.innerHTML = state.files
      .map(
        (file, index) => `
        <li class="pill-row">
          <span class="upload__file">
            <img class="upload__thumb" src="${previewUrl(file)}" alt="">
            <span class="upload__name">${escapeHtml(file.name)}</span>
          </span>
          <button class="btn btn--ghost btn--small" type="button" data-remove="${index}"
            aria-label="Remove ${escapeHtml(file.name)}">Remove</button>
        </li>`
      )
      .join('');
  }

  input.addEventListener('change', () => {
    const picked = Array.from(input.files);
    const images = picked.filter((file) => file.type.startsWith('image/'));
    error.textContent = images.length < picked.length ? 'Only image files can be added.' : '';
    addFiles(images);
    input.value = ''; // so choosing the same photo again still counts
    renderList();
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    const file = state.files[Number(button.dataset.remove)];
    removeFile(file);
    URL.revokeObjectURL(previewUrls.get(file));
    previewUrls.delete(file);
    error.textContent = '';
    renderList();
    input.focus();
  });

  renderList(); // photos chosen earlier show up again when you come back

  return {
    async beforeNext() {
      error.textContent = '';
      if (state.files.length === 0) {
        error.textContent = 'Add at least one photo to continue.';
        return false;
      }
      const signature = filesSignature(state.files);
      // Same photos as last time: keep the list the user already reviewed.
      if (signature === state.detectedFor) return true;
      try {
        const { ingredients } = await detectIngredients(state.files);
        applyDetected(ingredients, signature);
        return true;
      } catch (err) {
        error.textContent = friendlyError(err);
        return false;
      }
    },
    unmount() {
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
      previewUrls.clear();
    },
  };
}