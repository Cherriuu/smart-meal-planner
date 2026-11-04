import json
import os
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

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


def search_spoonacular(ingredients):
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
    data = search_spoonacular(request.ingredients)
    return {"recipes": [format_recipe(raw) for raw in data["results"]]}
