// The wizard: Preferences -> Upload -> Review -> Recipes, with Back and Next.
//
// Each step is a function mount(root, { next }) that draws itself into `root` and
// returns an optional { beforeNext, unmount }:
//   beforeNext()  runs when the user presses Next. Return false to stay on the step
//                 (show your own error message). It may be async.
//   unmount()     cleanup when the user leaves.
// A step must write what the user does into state.js (or its own saved copy),
// because the step is drawn again from scratch when the user comes back.
//
// The current step is in the URL (#/upload), so the browser's own Back/Forward
// buttons and a page refresh work too.

import './wizard.css';
import { getState, checkedIngredients } from './state.js';
import { hasSavedPreferences } from './preferences.js';
import { mountPreferences } from './steps/preferences.js';
import { mountUpload } from './steps/upload.js';
import { mountReview } from './steps/review.js';
import { mountRecipes } from './steps/recipes.js';

const STEPS = [
  { id: 'preferences', label: 'Preferences', mount: mountPreferences },
  { id: 'upload', label: 'Upload', mount: mountUpload },
  { id: 'review', label: 'Review', mount: mountReview },
  { id: 'recipes', label: 'Recipes', mount: mountRecipes },
];

// Can this step be opened right now? (Stops people jumping ahead through the URL.)
function canEnter(index) {
  const state = getState();
  switch (STEPS[index].id) {
    case 'upload':
      return hasSavedPreferences();
    case 'review':
      return state.detectedFor !== null;
    case 'recipes':
      return state.detectedFor !== null && checkedIngredients().length > 0;
    default:
      return true;
  }
}

// The furthest step we may show, no later than `index`.
function furthestAllowed(index) {
  for (let i = index; i > 0; i--) if (canEnter(i)) return i;
  return 0;
}

export function startWizard(app) {
  app.innerHTML = `
    <header class="app-header">
      <div class="app-header__inner"><span class="app-header__name">Smart Meal Planner</span></div>
    </header>
    <main class="page wizard">
      <nav aria-label="Progress" id="stepper"></nav>
      <section class="stack--lg" id="step" aria-labelledby="step-title"></section>
      <div class="wizard__nav">
        <button class="btn btn--secondary" type="button" id="back">Back</button>
        <button class="btn wizard__next" type="button" id="next">Next</button>
      </div>
    </main>
  `;

  const stepper = app.querySelector('#stepper');
  const stepEl = app.querySelector('#step');
  const backBtn = app.querySelector('#back');
  const nextBtn = app.querySelector('#next');

  let current = null; // { index, instance }
  let busy = false;   // true while a step's beforeNext is running

  const hashFor = (index) => `#/${STEPS[index].id}`;
  const indexFromHash = () => STEPS.findIndex((s) => `#/${s.id}` === location.hash);
  const replaceHash = (index) => history.replaceState(null, '', hashFor(index));

  function renderStepper() {
    const items = STEPS.map((step, i) => {
      const status = i < current.index ? 'done' : i === current.index ? 'current' : 'todo';
      const inner = `<span class="stepper__num" aria-hidden="true">${i + 1}</span><span class="stepper__label">${step.label}</span>`;
      const content = status === 'done'
        ? `<a class="stepper__link" href="${hashFor(i)}">${inner}</a>`
        : `<span class="stepper__link">${inner}</span>`;
      return `<li class="stepper__item stepper__item--${status}"${status === 'current' ? ' aria-current="step"' : ''}>${content}</li>`;
    });
    stepper.innerHTML = `<ol class="stepper">${items.join('')}</ol>`;
  }

  function show(index) {
    current?.instance.unmount?.();
    stepEl.innerHTML = '';
    const instance = STEPS[index].mount(stepEl, { next: goNext }) ?? {};
    current = { index, instance };

    renderStepper();
    backBtn.hidden = index === 0;
    nextBtn.hidden = index === STEPS.length - 1;

    // Tell screen readers where they are, and start at the top
    stepEl.querySelector('#step-title')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function setBusy(value) {
    busy = value;
    stepEl.inert = value;
    backBtn.disabled = value;
    nextBtn.disabled = value;
    nextBtn.innerHTML = value
      ? '<span class="spinner spinner--small" aria-hidden="true"></span> Working…'
      : 'Next';
  }

  // Runs the current step's check. True means "ok to leave forward".
  async function canLeaveForward() {
    setBusy(true);
    try {
      return (await current.instance.beforeNext?.()) !== false;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    if (busy || current.index >= STEPS.length - 1) return;
    if (!(await canLeaveForward())) {
      // The button was disabled, so focus fell back to the page: put it back
      if (document.activeElement === document.body) nextBtn.focus();
      return;
    }
    const target = furthestAllowed(current.index + 1);
    show(target);
    location.hash = hashFor(target);
  }

  function goBack() {
    if (busy || current.index === 0) return;
    const target = current.index - 1;
    show(target);
    location.hash = hashFor(target);
  }

  nextBtn.addEventListener('click', goNext);
  backBtn.addEventListener('click', goBack);

  // Browser Back/Forward buttons, the stepper links, or an edited URL
  window.addEventListener('hashchange', async () => {
    const wanted = indexFromHash();
    if (wanted === current.index) return; // we set this hash ourselves, nothing to do
    if (busy || wanted === -1) return replaceHash(current.index);

    if (wanted > current.index && !(await canLeaveForward())) {
      return replaceHash(current.index);
    }
    // Going forward is one step at a time, so nobody skips the Review step
    const limit = wanted > current.index ? current.index + 1 : wanted;
    const target = furthestAllowed(limit);
    show(target);
    if (target !== wanted) replaceHash(target);
  });

  // First load (or refresh): open the step in the URL if it is allowed
  const first = furthestAllowed(Math.max(indexFromHash(), 0));
  show(first);
  replaceHash(first);
}