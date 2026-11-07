import json
import os
from datetime import datetime, timezone
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv()

SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DAILY_SEARCH_LIMIT = int(os.getenv("DAILY_SEARCH_LIMIT", "50"))
# Stop when Spoonacular reports fewer points left than this (one search is ~1.55 points)
QUOTA_RESERVE = 5

# In-memory search counter for the current UTC day (resets on server restart)
search_count = 0
search_date = None
# Points left on the shared key, from Spoonacular's last response (None = unknown)
quota_left = None

SAMPLE_DATA_DIR = Path(__file__).parent / "sample_data"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_sample(filename):
    with open(SAMPLE_DATA_DIR / filename) as f:
        return json.load(f)


def daily_limit_reached():
    global search_count, search_date, quota_left
    today = datetime.now(timezone.utc).date()
    if search_date != today:
        search_date = today
        search_count = 0
        quota_left = None
    if quota_left is not None and quota_left < QUOTA_RESERVE:
        return True
    return search_count >= DAILY_SEARCH_LIMIT


def daily_limit_response():
    return JSONResponse(
        status_code=429,
        content={
            "error": "daily_limit",
            "message": "We've hit today's recipe limit. Please try again tomorrow!",
        },
    )


def search_spoonacular(ingredients):
    global search_count, quota_left
    # One complexSearch call returns everything we need for every recipe
    params = {
        "includeIngredients": ",".join(ingredients),
        "number": 5,
        "addRecipeInformation": True,
        "addRecipeInstructions": True,
        "addRecipeNutrition": True,
        "fillIngredients": True,
        "sort": "max-used-ingredients",
    }
    # Key goes in a header, not the URL, so it never shows up in error messages
    headers = {"x-api-key": SPOONACULAR_API_KEY}
    response = httpx.get(
        "https://api.spoonacular.com/recipes/complexSearch",
        params=params,
        headers=headers,
        timeout=10,
    )
    # Count here: the request reached Spoonacular, even if it returned an error
    search_count += 1
    # Spoonacular's own count for the whole key, so it includes teammates' searches
    try:
        quota_left = float(response.headers["X-API-Quota-Left"])
    except (KeyError, ValueError):
        pass  # header missing or not a number: keep the previous value
    response.raise_for_status()
    return response.json()


def format_recipe(raw):
    # Turn one Spoonacular result into the shape in sample_data/recipes.json
    calories = None
    for nutrient in raw.get("nutrition", {}).get("nutrients", []):
        if nutrient["name"] == "Calories":
            calories = round(nutrient["amount"])
            break

    ingredients = [
        {
            "name": item["name"],
            "amount": item["amount"],
            "unit": item.get("measures", {}).get("us", {}).get("unitShort", ""),
        }
        for item in raw.get("extendedIngredients", [])
    ]

    # Instructions can be split into sections; flatten them into one list
    steps = []
    appliances = []
    for section in raw.get("analyzedInstructions", []):
        for step in section["steps"]:
            steps.append(step["step"])
            for equipment in step.get("equipment", []):
                if equipment["name"] not in appliances:
                    appliances.append(equipment["name"])

    return {
        "id": raw["id"],
        "title": raw["title"],
        "image": raw.get("image"),
        "readyInMinutes": raw.get("readyInMinutes"),
        "servings": raw.get("servings"),
        "calories": calories,
        "ingredients": ingredients,
        "steps": steps,
        "appliances": appliances,
    }


class RecipeRequest(BaseModel):
    ingredients: list[str]
    appliances: list[str] = []
    servings: int = 2
    occasion: str = "casual"
    maxCalories: int | None = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "spoonacular_key_loaded": bool(SPOONACULAR_API_KEY),
        "gemini_key_loaded": bool(GEMINI_API_KEY),
    }


@app.post("/api/detect-ingredients")
def detect_ingredients(images: list[UploadFile] = File(...)):
    # TODO (#6): send the images to Gemini
    return load_sample("detect_ingredients.json")


@app.post("/api/recipes")
def get_recipes(request: RecipeRequest):
    # No key means local testing: use sample data and skip the daily limit
    if not SPOONACULAR_API_KEY:
        return load_sample("recipes.json")
    if daily_limit_reached():
        return daily_limit_response()
    try:
        data = search_spoonacular(request.ingredients)
    except httpx.HTTPStatusError as error:
        # 402 means Spoonacular says our daily points are used up
        if error.response.status_code == 402:
            return daily_limit_response()
        raise
    return {"recipes": [format_recipe(raw) for raw in data["results"]]}
