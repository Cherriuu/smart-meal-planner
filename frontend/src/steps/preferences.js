// Step 1: the preferences page from issue #8, running inside the wizard.
import { renderPreferences } from '../preferences.js';
import { startBlink } from '../util.js';

export function mountPreferences(root, { next }) {
  const form = renderPreferences(root, { embedded: true, onSubmit: next });
  const stopBlink = startBlink(root);
  // Next only goes ahead when the values are valid (they are saved at the same time).
  return {
    beforeNext: () => form.save(),
    unmount: stopBlink,
  };
}
