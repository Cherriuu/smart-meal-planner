import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()

SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DAILY_SEARCH_LIMIT = int(os.getenv("DAILY_SEARCH_LIMIT", "50"))
# Stop when Spoonacular reports fewer points left than this (one search is ~3.2 points,
# ~4.2 with a calorie/protein/sugar limit)
QUOTA_RESERVE = 5
GEMINI_MODEL = "gemini-3.6-flash"
# Spoonacular recipe types for each occasion; several types mean "any of these".
# An empty list, or an occasion not listed here, searches all types.
OCCASION_TYPES = {
    "casual": [],
    "family dinner": ["main course"],
    "birthday": ["fingerfood", "appetizer", "dessert"],
    "potluck": ["side dish", "appetizer"],
    "holiday": ["main course", "side dish", "dessert"],
}
# Nutrition limits in grams per serving, sent to Spoonacular
HIGH_PROTEIN_MIN = 20
LOW_SUGAR_MAX = 10
# Keep recipes that need at most this many foods the user doesn't have (basics don't count)
MAX_MISSING_INGREDIENTS = 2
# Items left out of ingredient lists: drinks that aren't ingredients, plus basics
# everyone has (salt, pepper, oil). Recipes may use these without the user listing them.
SKIPPED_INGREDIENTS = {
    "water", "sparkling water", "soda", "ice", "ice cube",
    "salt", "kosher salt", "sea salt", "pepper", "black pepper", "salt and pepper",
    "oil", "olive oil", "vegetable oil", "cooking oil", "cooking spray", "nonstick cooking spray",
    "butter",
}
# Kitchen supplies Spoonacular lists as ingredients or equipment (singular, like
# normalize_name gives). Never "missing", and not shown as appliances.
NON_FOOD = {
    "paper towel", "aluminum foil", "parchment paper", "plastic wrap",
    "wax paper", "toothpick", "kitchen twine",
}
# Words that can come before a food and still be that food ("cherry tomato" is a tomato,
# "sundried tomato" isn't)
VARIETY_WORDS = {
    "cherry", "roma", "grape", "plum", "corn", "flour", "whole wheat",
    "mild", "sharp", "extra sharp", "baby", "red", "white", "yellow", "green",
    "large", "medium", "small", "fresh", "organic",
}
# "... butter" counts as butter (a basic), except these nut and seed butters
NUT_BUTTERS = ("peanut", "almond", "cashew", "hazelnut", "pecan", "walnut",
               "pistachio", "macadamia", "sunflower seed", "nut")
# Different names for the same food, mapped to the name Spoonacular uses
INGREDIENT_ALIASES = {
    "scallion": "green onion",
    "spring onion": "green onion",
    "coriander": "cilantro",
    "garbanzo bean": "chickpea",
    "capsicum": "bell pepper",
}
# Spoonacular equipment names -> appliances on the preferences page.
# Equipment not listed here (bowl, whisk, knife...) doesn't need an appliance.
EQUIPMENT_TO_APPLIANCE = {
    "oven": "Oven", "baking sheet": "Oven", "baking pan": "Oven",
    "casserole dish": "Oven", "loaf pan": "Oven", "muffin tray": "Oven",
    "roasting pan": "Oven",
    "frying pan": "Stovetop", "pan": "Stovetop", "pot": "Stovetop",
    "saucepan": "Stovetop", "sauce pan": "Stovetop", "skillet": "Stovetop",
    "wok": "Stovetop", "stove": "Stovetop",
    "microwave": "Microwave",
    "air fryer": "Air fryer",
    "toaster": "Toaster",
}
# Backup for incomplete equipment lists: steps with these words need an oven
OVEN_WORDS = re.compile(r"\b(bake|baked|preheat|oven)\b", re.IGNORECASE)
# Spoonacular sometimes lists equipment as an ingredient ("12-inch skillet").
# Whole words only, so "potato" doesn't match "pot".
EQUIPMENT_WORDS = re.compile(r"\b(" + "|".join(re.escape(name) for name in EQUIPMENT_TO_APPLIANCE) + r")\b")
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


def search_spoonacular(request):
    global search_count, quota_left
    # One complexSearch call returns everything we need for every recipe.
    # Ask for 20 because our filters drop recipes that need foods the user doesn't have.
    params = {
        "includeIngredients": ",".join(request.ingredients),
        "number": 20,
        "addRecipeInformation": True,
        "addRecipeInstructions": True,
        "addRecipeNutrition": True,
        "fillIngredients": True,
        "sort": "min-missing-ingredients",
    }
    # "Potluck " and "potluck" should match the same entry
    recipe_types = OCCASION_TYPES.get(request.occasion.strip().lower(), [])
    if recipe_types:
        params["type"] = ",".join(recipe_types)
    if request.maxCalories is not None:
        params["maxCalories"] = request.maxCalories
    if request.highProtein:
        params["minProtein"] = HIGH_PROTEIN_MIN
    if request.lowSugar:
        params["maxSugar"] = LOW_SUGAR_MAX
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
            # nameClean drops extras like "fresh", so the ingredient filter matches more often
            "name": item.get("nameClean") or item["name"],
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
                if equipment["name"] not in appliances and normalize_name(equipment["name"]) not in NON_FOOD:
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
    servings: int = Field(2, ge=1, le=50)
    occasion: str = "casual"
    maxCalories: int | None = None
    # Sent to Spoonacular as minProtein / maxSugar (see HIGH_PROTEIN_MIN, LOW_SUGAR_MAX)
    highProtein: bool = False
    lowSugar: bool = False


def scale_servings(recipe, servings):
    # Multiply every amount so the recipe feeds `servings` people (2 -> 6 triples it)
    original = recipe["servings"]
    if not original:
        return  # unknown serving size, nothing to scale from
    factor = servings / original
    for ingredient in recipe["ingredients"]:
        ingredient["amount"] = round(ingredient["amount"] * factor, 2)
    recipe["servings"] = servings


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


def normalize_name(name):
    # One spelling per food, so "Baby Scallions" and "green onion" compare equal
    name = name.lower().split(" - ")[0]  # "egg - beat" -> "egg"
    name = " ".join(name.replace("&", " and ").split())  # "salt & pepper", tidy spaces
    for prefix in SIZE_PREFIXES:
        rest = name[len(prefix):]
        # Keep "mini pepper": without the prefix it would be dropped as a basic
        if name.startswith(prefix) and singular(rest) not in SKIPPED_INGREDIENTS:
            name = rest
    name = singular(name)
    if name.endswith(" leaf"):
        name = name[:-len(" leaf")]  # "spinach leaf" -> "spinach"
    if name.endswith(" butter") and not name[:-len(" butter")].endswith(NUT_BUTTERS):
        name = "butter"  # "unsalted butter" -> "butter", but not "peanut butter"
    return INGREDIENT_ALIASES.get(name, name)


def clean_ingredients(names):
    cleaned = []
    for name in names:
        name = normalize_name(name)
        if name and name not in SKIPPED_INGREDIENTS and name not in cleaned:
            cleaned.append(name)
    return cleaned


def only_variety_words(text):
    # True when every word is in VARIETY_WORDS ("whole wheat" counts as one)
    words = text.split()
    i = 0
    while i < len(words):
        if " ".join(words[i:i + 2]) in VARIETY_WORDS:
            i += 2
        elif words[i] in VARIETY_WORDS:
            i += 1
        else:
            return False
    return True


def has_food(name, available):
    # "cherry tomato" counts as "tomato", but "sundried tomato" and "potato" don't
    for food in available:
        if name == food:
            return True
        if name.endswith(" " + food) and only_variety_words(name[:-len(food)]):
            return True
    return False


def foods_used(recipe, available):
    # How many of the user's foods this recipe uses; each counts once, basics don't count
    names = [normalize_name(ingredient["name"]) for ingredient in recipe["ingredients"]]
    names = [name for name in names if name not in SKIPPED_INGREDIENTS and name not in NON_FOOD]
    return sum(
        1 for food in available
        if food not in SKIPPED_INGREDIENTS and any(has_food(name, {food}) for name in names)
    )


def missing_ingredients(recipe, available):
    # Display names of the foods this recipe needs that the user doesn't have.
    # Basics (salt, oil, butter...), kitchen supplies and equipment listed as an ingredient don't count.
    missing = []
    for ingredient in recipe["ingredients"]:
        name = normalize_name(ingredient["name"])
        if name in SKIPPED_INGREDIENTS or name in NON_FOOD or EQUIPMENT_WORDS.search(name):
            continue
        if not has_food(name, available) and ingredient["name"] not in missing:
            missing.append(ingredient["name"])
    return missing


def needs_only_selected_appliances(recipe, selected):
    # `selected` is the user's appliances in lowercase
    for equipment in recipe["appliances"]:
        appliance = EQUIPMENT_TO_APPLIANCE.get(equipment.lower())
        if appliance and appliance.lower() not in selected:
            return False
    if "oven" not in selected:
        for step in recipe["steps"]:
            if OVEN_WORDS.search(step):
                return False
    return True


def fits_request(recipe, request):
    # Also records what's missing on the recipe, since the response shows it
    if not recipe["steps"]:
        return False  # nothing to follow
    selected ={appliance.strip().lower() for appliance in request.appliances}
    # No appliances selected means the user didn't say, so don't filter by them
    if selected and not needs_only_selected_appliances(recipe, selected):
        return False
    available = {normalize_name(name) for name in request.ingredients}
    recipe["missingIngredients"] = missing_ingredients(recipe, available)
    if len(recipe["missingIngredients"]) > MAX_MISSING_INGREDIENTS:
        return False
    return True


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
        recipes = load_sample("recipes.json")["recipes"]
        # Spoonacular applies maxCalories for real searches; do it here for sample data
        if request.maxCalories is not None:
            recipes = [
                recipe for recipe in recipes
                if recipe["calories"] is None or recipe["calories"] <= request.maxCalories
            ]
    else:
        if daily_limit_reached():
            return daily_limit_response()
        try:
            data = search_spoonacular(request)
        except httpx.HTTPStatusError as error:
            # 402 means Spoonacular says our daily points are used up
            if error.response.status_code == 402:
                return daily_limit_response()
            raise
        recipes = [format_recipe(raw) for raw in data["results"]]

    recipes = [recipe for recipe in recipes if fits_request(recipe, request)]
    # Fewest missing foods first, then the ones using most of the user's foods,
    # then quickest; recipes without a time go last
    available = {normalize_name(name) for name in request.ingredients}
    recipes.sort(key=lambda recipe: (
        len(recipe["missingIngredients"]),
        -foods_used(recipe, available),
        recipe["readyInMinutes"] is None,
        recipe["readyInMinutes"] or 0,
    ))
    recipes = recipes[:5]

    for recipe in recipes:
        scale_servings(recipe, request.servings)

    return {"recipes": recipes}
