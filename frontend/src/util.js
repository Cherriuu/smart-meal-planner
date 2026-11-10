// Small helpers shared by the wizard steps.

// Anything that came from a user or the API must go through this before it is put into innerHTML.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

// A message a person can understand, for a failed request.
export function friendlyError(error) {
  if (error instanceof TypeError) {
    return "Can't reach the server. Make sure the backend is running, then try again.";
  }
  return error.message || 'Something went wrong. Please try again.';
}