import json
import os
from datetime import datetime, timezone
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from pydantic import BaseModel

load_dotenv()

SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DAILY_SEARCH_LIMIT = int(os.getenv("DAILY_SEARCH_LIMIT", "50"))
# Stop when Spoonacular reports fewer points left than this (one search is ~1.55 points)
QUOTA_RESERVE = 5
GEMINI_MODEL = "gemini-3.6-flash"
# Items left out of ingredient lists: drinks that aren't ingredients, plus basics
# everyone has (salt, pepper, oil). Reused by #9.
SKIPPED_INGREDIENTS = {
    "water", "sparkling water", "soda", "ice", "ice cube",
    "salt", "pepper", "black pepper",
    "oil", "olive oil", "vegetable oil", "cooking oil",
}
# Size words that aren't a real variety ("baby carrot" is just "carrot")
SIZE_PREFIXES = ("baby ", "mini ")
# Plurals the simple rules in singular() get wrong ("pies" would become "py")
IRREGULAR_PLURALS = {
    "pies": "pie",
    "cookies": "cookie",
    "brownies": "brownie",
    "leaves": "leaf",
    "loaves": "loaf",
}

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


def detect_foods_with_gemini(images):
    # Send all photos in one request; Gemini answers with a JSON list of food names
    client = genai.Client(api_key=GEMINI_API_KEY)
    parts = [
        types.Part.from_bytes(data=image.file.read(), mime_type=image.content_type)
        for image in images
    ]
    prompt = (
        "List every food item you can see in these photos. "
        "Use singular, lowercase, common names: 'egg' not 'eggs', "
        "'basil' not 'basil leaves', 'cheddar cheese' not 'Cheddar Cheese'."
    )
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=parts + [prompt],
        config={
            "response_mime_type": "application/json",
            "response_json_schema": {"type": "array", "items": {"type": "string"}},
        },
    )
    return json.loads(response.text)


def singular(name):
    # Only the last word is plural: "cherry tomatoes" -> "cherry tomato"
    words = name.split(" ")
    last = words[-1]
    if last in IRREGULAR_PLURALS:
        last = IRREGULAR_PLURALS[last]
    elif last in ("hummus", "couscous", "asparagus", "molasses", "swiss"):
        pass
    elif last.endswith("ies"):
        last = last[:-3] + "y"  # berries -> berry
    elif last.endswith(("oes", "ches", "shes", "xes")):
        last = last[:-2]  # tomatoes -> tomato, peaches -> peach
    elif last.endswith("s") and not last.endswith(("ss", "us", "is")):
        last = last[:-1]  # eggs -> egg
    words[-1] = last
    return " ".join(words)


def clean_ingredients(names):
    cleaned = []
    for name in names:
        name = " ".join(name.lower().split())  # lowercase, tidy spaces
        for prefix in SIZE_PREFIXES:
            rest = name[len(prefix):]
            # Keep "mini pepper": without the prefix it would be dropped as a basic
            if name.startswith(prefix) and singular(rest) not in SKIPPED_INGREDIENTS:
                name = rest
        name = singular(name)
        if name and name not in SKIPPED_INGREDIENTS and name not in cleaned:
            cleaned.append(name)
    return cleaned


@app.post("/api/detect-ingredients")
def detect_ingredients(images: list[UploadFile] = File(...)):
    # No key means local testing: use sample data instead of calling Gemini
    if not GEMINI_API_KEY:
        return load_sample("detect_ingredients.json")
    return {"ingredients": clean_ingredients(detect_foods_with_gemini(images))}


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
