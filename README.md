# Smart Meal Planner (GWC Group Project)

A web application that generates personalized recipe recommendations based on available ingredients, dietary preferences, kitchen appliances, serving sizes, and occasions. The application will use computer vision to identify ingredients from uploaded photos, allowing users to discover recipes they can prepare with what they already have.

## Proposed Features

- **Kitchen Appliances:** Users can select which appliances they have available (e.g., oven, microwave, air fryer, toaster). Recipes requiring unavailable appliances will be excluded.
- **Dietary and Nutritional Preferences:** Users can specify calorie goals and nutritional preferences, such as higher protein or lower sugar intake.
- **Pantry Inventory (Computer Vision):** Users can upload photos of their available ingredients. Computer vision will identify the ingredients, and users can review or manually adjust the results. Spoonacular will take out of account simple pantry ingredients such as salt, pepper, etc.
- Users should be able to review detected ingredients and approve of it before getting any recipes
- **Ingredient-Based Recipe Recommendations:** The application will recommend recipes that can be prepared using the user's available ingredients, without requiring additional grocery purchases.
- **Serving Sizes:** Users can specify how many people they are cooking for, allowing recipe quantities to be adjusted accordingly.
- **Occasion Selection:** Users can choose an occasion, such as a casual meal, family dinner, birthday party, potluck, or holiday gathering. Recipe recommendations will be tailored to the selected occasion.
- **Recipe Sorting:** Matching recipes will be displayed in order of shortest to longest total preparation and cooking time.


## Tech Stack

| Area | Technology |
|------|------------|
| Frontend | JavaScript, HTML, CSS |
| Dev environment | Node.js |
| Backend | Python, FastAPI |
| Computer vision | Gemini |
| Recipe data API | Spoonacular |
| Database |  Will be implemented depending on other features or changes |
| Deployment | TBD |

## Running the backend

1. Go into the backend folder:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   # Mac
   python3 -m venv venv
   source venv/bin/activate

   # Windows
   python -m venv venv
   venv\Scripts\activate
   ```
3. Install the dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create your `.env` file. Leave the keys blank to use the sample data:
   ```bash
   cp .env.example .env
   ```
5. Start the server:
   ```bash
   uvicorn main:app --reload
   ```
6. Check that it works:
   - http://localhost:8000/health should return `"status": "ok"`
   - http://localhost:8000/docs shows every endpoint, and you can try them from there

## Team

| Role | Members | Tasks | 
|------|---------|-------|
| Frontend | Rhea, Adiam | User interface, image upload, preferences selection, recipe display |
| Backend | Jesica | API development, computer vision integration, recipe recommendation logic |

