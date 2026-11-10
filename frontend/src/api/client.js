const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, options);

  if (!response.ok) {
    // The backend sends a friendly "message" for some errors (like the daily limit)
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // body wasn't JSON: keep the generic message
    }
    throw new Error(message);
  }

  return response.json();
}

// Check that the backend is running
export function checkHealth() {
  return request('/health');
}

// Send photos, get back detected ingredients
export function detectIngredients(imageFiles) {
  const formData = new FormData();
  imageFiles.forEach((file) => formData.append('images', file));

  return request('/api/detect-ingredients', {
    method: 'POST',
    body: formData,
  });
}

// Send ingredients + preferences, get back recipes
export function getRecipes(preferences) {
  return request('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
}