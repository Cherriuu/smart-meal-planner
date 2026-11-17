// Step 2: pick photos. Pressing Next sends them to the backend to find ingredients.
import { addFiles, removeFile, getState, filesSignature, applyDetected, startManually } from '../state.js';
import { detectIngredients } from '../api/client.js';
import { escapeHtml, friendlyError, resizePhoto, helperHtml, startBlink, icon, mascotBlink } from '../util.js';

export function mountUpload(root, { next } = {}) {
  const state = getState();
  const previewUrls = new Map(); // File -> temporary URL for its thumbnail
  let manual = false; // the user chose "Add foods by hand": Next must not try detection again
  let scan = null;    // the "Finding your ingredients" overlay while detection runs

  root.innerHTML = `
    ${helperHtml('Upload photos', "Snap your fridge, pantry or groceries. I'll find the ingredients for you.")}
    <div class="card section upload__card">
      <input class="visually-hidden upload__input" id="photos" type="file" accept="image/*" multiple>
      <label class="drop" id="drop" for="photos">
        <span class="drop__camera">${icon('camera', 36, 1.8)}</span>
        <strong>Drop photos here</strong>
        <span class="text-soft">or click to choose · you can add more than one</span>
      </label>
      <ul class="upload__list" id="upload-list"></ul>
      <p class="field__error" id="upload-error" role="alert"></p>
      <div class="upload__fallback" id="upload-fallback" hidden>
        <button class="btn btn--secondary" type="button" id="add-by-hand" data-add-by-hand>Add foods by hand</button>
      </div>
    </div>
    <p class="text-soft upload__manual">No photo handy? <button class="link-btn" type="button" data-add-by-hand>Add foods by hand</button></p>
  `;

  const input = root.querySelector('#photos');
  const drop = root.querySelector('#drop');
  const list = root.querySelector('#upload-list');
  const error = root.querySelector('#upload-error');
  const fallback = root.querySelector('#upload-fallback');
  const stopBlink = startBlink(root);

  function previewUrl(file) {
    if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file));
    return previewUrls.get(file);
  }

  function renderList() {
    list.innerHTML = state.files
      .map(
        (file, index) => `
        <li class="upload__thumb">
          <img src="${previewUrl(file)}" alt="${escapeHtml(file.name)}">
          <button class="icon-btn upload__remove" type="button" data-remove="${index}"
            aria-label="Remove ${escapeHtml(file.name)}">${icon('close', 16, 2.5)}</button>
        </li>`
      )
      .join('');
  }

  // Photos from the file picker or dropped on the drop zone: images only
  function addPicked(fileList) {
    const picked = Array.from(fileList);
    const images = picked.filter((file) => file.type.startsWith('image/'));
    error.textContent = images.length < picked.length ? 'Only image files can be added.' : '';
    addFiles(images);
    renderList();
  }

  input.addEventListener('change', () => {
    addPicked(input.files);
    input.value = ''; // so choosing the same photo again still counts
  });

  drop.addEventListener('dragover', (event) => {
    event.preventDefault(); // lets the drop happen
    drop.classList.add('drop--over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop--over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('drop--over');
    addPicked(event.dataTransfer.files);
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

  // No photos, or detection failed: carry on without it (the Review step has the "Add an ingredient" form)
  for (const button of root.querySelectorAll('[data-add-by-hand]')) {
    button.addEventListener('click', () => {
      startManually();
      manual = true;
      next?.();
    });
  }

  // The scanning card over the page while Gemini reads the photos (our own text, plus the photo count)
  function showScan() {
    const count = state.files.length;
    scan = document.createElement('div');
    scan.className = 'scan';
    scan.setAttribute('role', 'status');
    scan.innerHTML = `
      <div class="card scan__card">
        <div class="scan__photo">
          <img src="${previewUrl(state.files[0])}" alt="">
          <div class="scan__line"></div>
        </div>
        <img class="scan__mascot pixel" src="${mascotBlink}" width="64" height="64" alt="">
        <p class="scan__title"><span class="scan__dots">Finding your ingredients</span></p>
        <span class="text-soft">Gemini is looking at ${count} photo${count === 1 ? '' : 's'}</span>
      </div>`;
    document.body.append(scan);
  }

  function hideScan() {
    scan?.remove();
    scan = null;
  }

  renderList(); // photos chosen earlier show up again when you come back

  return {
    async beforeNext() {
      if (manual) return true;
      error.textContent = '';
      fallback.hidden = true;
      if (state.files.length === 0) {
        error.textContent = 'Add at least one photo to continue.';
        return false;
      }
      const signature = filesSignature(state.files);
      // Same photos as last time: keep the list the user already reviewed.
      if (signature === state.detectedFor) return true;
      showScan();
      try {
        // Send smaller, upright copies; Review shows these exact images under the boxes
        const photos = await Promise.all(state.files.map((file) => resizePhoto(file)));
        const { ingredients, detections } = await detectIngredients(photos);
        applyDetected(ingredients, signature, detections ?? [], photos);
        return true;
      } catch (err) {
        error.textContent = friendlyError(err);
        fallback.hidden = false;
        return false;
      } finally {
        hideScan();
      }
    },
    unmount() {
      stopBlink();
      hideScan();
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
      previewUrls.clear();
    },
  };
}
