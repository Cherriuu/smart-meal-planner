# smart-meal-planner
GWC group project

# Smart Meal Planner

A web app that recommends personalized recipes based on the ingredients you already have. Upload a photo of your pantry, review the detected ingredients, set your preferences, and get recipes you can make without a grocery run.

## Features

- **Pantry scan:** upload photos of your ingredients and let computer vision identify them
- **Ingredient review:** confirm, edit, or remove detected ingredients before getting recipes
- **Kitchen appliances:** select what you own (oven, microwave, air fryer, etc.) and recipes needing anything else are excluded
- **Dietary preferences:** set calorie goals and nutrition preferences like higher protein or lower sugar
- **Serving sizes:** scale recipe quantities to the number of people you're cooking for
- **Occasions:** tailor suggestions to a casual meal, family dinner, birthday, potluck, or holiday
- **Smart sorting:** recipes are shown from shortest to longest total prep and cook time

## Tech Stack

| Area | Technology |
|------|------------|
| Frontend | JavaScript, HTML, CSS |
| Dev environment | Node.js (Vite) |
| Backend | Python, FastAPI |
| Computer vision | TBD |
| Recipe data | TBD |
| Database | TBD |
| Deployment | TBD |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- npm (comes with Node.js)
- The backend running locally (see the backend README)

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-org>/smart-meal-planner.git
cd smart-meal-planner

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Start the dev server
npm run dev
```

The app will be available at `http://localhost:5173`.

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Base URL of the FastAPI backend | `http://localhost:8000` |

## Project Structure

```
src/
├── api/          # Calls to the backend
├── components/   # Reusable UI components
├── pages/        # Main app views
├── state/        # Shared app state
├── utils/        # Helper functions
└── styles/       # CSS files
```

## Team

| Role | Members |
|------|---------|
| Frontend | Rhea, Adiam |
| Backend | Lenaa, Jesica |

## Contributing

1. Pull the latest `main`: `git pull origin main`
2. Create a branch: `git checkout -b feature/your-feature-name`
3. Commit your changes with clear messages
4. Push and open a pull request
5. Get at least one teammate to review before merging

Please don't commit directly to `main` and never commit your `.env` file.

## Roadmap

- [ ] Project setup and base layout
- [ ] Appliance and preference selection
- [ ] Image upload and ingredient review
- [ ] Recipe results and sorting
- [ ] Serving size scaling and occasion filters
- [ ] Deployment
