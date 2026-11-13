import json
import os
import re
import traceback
from datetime import datetime, timezone
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()

SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DAILY_SEARCH_LIMIT = int(os.getenv("DAILY_SEARCH_LIMIT", "50"))
# Stop when Spoonacular reports fewer points left than this (one search is ~4.3 points,
# ~5.3 with a calorie/protein/sugar limit)
QUOTA_RESERVE = 5
GEMINI_MODEL = "gemini-3.8-flash"
# Photo detection gives up quickly: ~15 s per attempt and at most 1 SDK retry,
# then one try with SWAP_MODEL (Flash-Lite) if the main model is overloaded
DETECT_TIMEOUT_MS = 15000
DETECT_RETRY = {"attempts": 1}
# Browsers allowed to call the API: any localhost port, plus the deployed frontend
# URL(s) from ALLOWED_ORIGINS (comma-separated)
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/") for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()
]
LOCAL_ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1)(:\d+)?"
# Smart swaps use the fast, cheap Flash-Lite model and their own daily limit
SWAP_MODEL = "gemini-3.5-flash-lite"
DAILY_SWAP_LIMIT = int(os.getenv("DAILY_SWAP_LIMIT", "100"))
# Testing recipe filters without spending Spoonacular quota:
# SAVE_SPOONACULAR=1 saves each successful search's raw JSON to sample_data/spoonacular_capture.json,
# USE_CAPTURE=1 replays that file instead of calling Spoonacular
SAVE_SPOONACULAR = os.getenv("SAVE_SPOONACULAR") == "1"
USE_CAPTURE = os.getenv("USE_CAPTURE") == "1"
# Photo upload limits, checked before anything is sent to Gemini
MAX_PHOTOS = 5
MAX_PHOTO_BYTES = 5 * 1024 * 1024
DAILY_DETECT_LIMIT = int(os.getenv("DAILY_DETECT_LIMIT", "30"))
# Spoonacular recipe types for each occasion; several types mean "any of these".
# An empty list, or an occasion not listed here, searches all types.
OCCASION_TYPES = {
    "casual": [],
    "family dinner": ["main course"],
    "birthday": ["fingerfood", "appetizer", "dessert"],
    "potluck": ["side dish", "appetizer"],
    "holiday": ["main course", "side dish", "dessert"],
}
# Spoonacular "occasions" that make a recipe a holiday pick; sorted first for "holiday"
HOLIDAY_OCCASIONS = {
    "thanksgiving", "christmas", "easter", "new year's eve", "hanukkah",
    "4th of july", "fall", "winter",
}
# Words ignored when deciding if a name is just salt and/or pepper (a basic),
# so "kosher salt and freshly ground black pepper" counts as a basic
SALT_PEPPER_FILLER = {"and", "ground", "kosher", "fresh", "freshly", "cracked", "coarse", "fine"}
SALT_PEPPER_WORDS = {"salt", "pepper", "black", "sea"}
# Nutrition limits in grams per serving, sent to Spoonacular
HIGH_PROTEIN_MIN = 20
LOW_SUGAR_MAX = 10
# Missing foods are mainly for ranking (fewest missing first, see get_recipes). This is only
# a safety net: recipes needing more than this many foods the user doesn't have are dropped.
MAX_MISSING_INGREDIENTS = 5
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
# Pantry staples most kitchens have (Spoonacular gets ignorePantry=True too). Like basics,
# they're never "missing" and don't count as used, but they stay in photo detection results.
# Spelled the way normalize_name returns them ("bay leaf" -> "bay").
PANTRY_STAPLES = {
    "garlic", "garlic clove",
    "sugar", "brown sugar", "powdered sugar",
    "flour", "all purpose flour", "all-purpose flour",
    "baking powder", "baking soda", "vanilla extract", "cornstarch", "honey",
    "vinegar", "soy sauce", "chicken broth", "vegetable broth",
    "ground cinnamon", "ground cumin", "dried oregano", "dried thyme", "bay", "nutmeg",
    "red pepper flake",
}
# Words that can come before a food and still be that food ("cherry tomato" is a tomato,
# "sundried tomato" isn't)
VARIETY_WORDS = {
    "cherry", "roma", "grape", "plum", "corn", "flour", "whole wheat",
    "mild", "sharp", "extra sharp", "baby", "red", "white", "yellow", "green",
    "large", "medium", "small", "fresh", "organic",
    # Prep and descriptor words: "shredded cheddar cheese" is still cheddar cheese
    "shredded", "grated", "diced", "chopped", "minced", "sliced", "cooked",
    "lean", "extra lean", "boneless", "skinless", "whole", "long grain",
    "jasmine", "basmati", "low fat", "reduced fat", "canned", "frozen",
}
# A user's "chicken breast" covers a recipe's "chicken" (the recipe names the first word(s)),
# unless the user's extra words make it a different product: "chicken broth" isn't chicken,
# "peanut butter" isn't peanuts, "egg noodle" isn't egg
DIFFERENT_PRODUCT_WORDS = {
    "broth", "stock", "bouillon", "soup", "sauce", "gravy", "dressing", "juice", "milk",
    "powder", "paste", "extract", "seasoning", "oil", "vinegar", "butter", "spread",
    "jam", "jelly", "syrup", "chocolate", "flour", "noodle", "pasta", "bread",
    "tortilla", "cracker", "chip", "cereal", "cake", "pudding",
}
# "... butter" counts as butter (a basic), except these: nut and seed butters,
# apple butter, cocoa butter, shea butter
NOT_BUTTER = ("peanut", "almond", "cashew", "hazelnut", "pecan", "walnut",
              "pistachio", "macadamia", "sunflower seed", "nut",
              "apple", "cocoa", "shea")
# "... oil" counts as oil (a basic), except these flavoring oils
NOT_OIL = ("sesame", "truffle", "chili")
# Spices count as foods the user has, but aren't sent to Spoonacular's
# includeIngredients, so they don't steer which recipes come back
SPICES = {
    "paprika", "garlic powder", "onion powder", "cumin", "chili powder",
    "oregano", "basil", "thyme", "cinnamon", "red pepper flake", "italian seasoning",
}
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
# Only names ending in an equipment word, so "pot roast" and "potato" stay foods.
EQUIPMENT_WORDS = re.compile(r"\b(" + "|".join(re.escape(name) for name in EQUIPMENT_TO_APPLIANCE) + r")$")
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
# In-memory Gemini photo detection counter for the current UTC day
detect_count = 0
detect_date = None
# In-memory Gemini smart swap counter for the current UTC day
swap_count = 0
swap_date = None

SAMPLE_DATA_DIR = Path(__file__).parent / "sample_data"
CAPTURE_FILE = SAMPLE_DATA_DIR / "spoonacular_capture.json"

app = FastAPI()


# Any uncaught error becomes friendly JSON. This is middleware rather than an
# exception handler, and it's added before CORSMiddleware so CORS wraps it:
# that way the error response gets CORS headers and the frontend can read it
# (instead of reporting "Can't reach the server").
@app.middleware("http")
async def catch_unexpected_errors(request, call_next):
    try:
        return await call_next(request)
    except Exception:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": "server_error", "message": "Something went wrong. Please try again."},
        )


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
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


def daily_detect_limit_reached():
    global detect_count, detect_date
    today = datetime.now(timezone.utc).date()
    if detect_date != today:
        detect_date = today
        detect_count = 0
    return detect_count >= DAILY_DETECT_LIMIT


def daily_swap_limit_reached():
    global swap_count, swap_date
    today = datetime.now(timezone.utc).date()
    if swap_date != today:
        swap_date = today
        swap_count = 0
    return swap_count >= DAILY_SWAP_LIMIT


def daily_detect_limit_response():
    return JSONResponse(
        status_code=429,
        content={
            "error": "daily_detect_limit",
            "message": "We've hit today's photo limit. Please try again tomorrow, or add your ingredients by hand.",
        },
    )


def detect_unavailable_response():
    return JSONResponse(
        status_code=503,
        content={
            "error": "detect_unavailable",
            "message": "Our photo reader is busy right now. Try again in a minute, or add your ingredients by hand.",
        },
    )


def upload_error(error, message):
    return JSONResponse(status_code=400, content={"error": error, "message": message})


def photo_too_large(image):
    # UploadFile.size is usually set; if not, measure the file and rewind it for Gemini
    if image.size is not None:
        return image.size > MAX_PHOTO_BYTES
    too_large = len(image.file.read()) > MAX_PHOTO_BYTES
    image.file.seek(0)
    return too_large


def search_spoonacular(request):
    global search_count, quota_left
    # One complexSearch call returns everything we need for every recipe.
    # Ask for 30 because our filters (missing foods, occasion, appliances) drop many.
    foods = [name for name in request.ingredients if normalize_name(name) not in SPICES]
    params = {
        "includeIngredients": ",".join(foods),
        "number": 30,
        "addRecipeInformation": True,
        "addRecipeInstructions": True,
        "addRecipeNutrition": True,
        "fillIngredients": True,
        # Our own filter handles missing foods, so rank by how many of the user's foods are used
        "sort": "max-used-ingredients",
        "ignorePantry": True,
    }
    # No "type" param: the occasion is filtered by our own code (fits_request)
    if request.maxCalories is not None:
        params["maxCalories"] = request.maxCalories
    if request.highProtein:
        params["minProtein"] = HIGH_PROTEIN_MIN
    if request.lowSugar:
        params["maxSugar"] = LOW_SUGAR_MAX
    # Key goes in a header, not the URL, so it never shows up in error messages
    headers = {"x-api-key": SPOONACULAR_API_KEY}
    print(f"[recipes] Spoonacular params (key is in a header, not here): {params}", flush=True)  # DEBUG recipes
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
    if SAVE_SPOONACULAR:
        CAPTURE_FILE.write_text(json.dumps(response.json(), indent=2))
        print(f"[capture] saved this Spoonacular response to {CAPTURE_FILE}", flush=True)
    print(f"[recipes] Spoonacular totalResults={response.json().get('totalResults')}, returned {len(response.json().get('results', []))} recipes", flush=True)  # DEBUG recipes
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
        # Used for the occasion filter and holiday sort
        "dishTypes": [dish_type.lower() for dish_type in raw.get("dishTypes") or []],
        "occasions": [occasion.lower() for occasion in raw.get("occasions") or []],
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


def suggest_swaps_with_gemini(recipes, user_foods):
    # One request for all recipes; returns {recipe id: {missing ingredient: suggested food}}
    client = genai.Client(api_key=GEMINI_API_KEY, http_options={"timeout": 8000})
    payload = {
        "userFoods": user_foods,
        "recipes": [
            {"id": recipe["id"], "title": recipe["title"], "missingIngredients": recipe["missingIngredients"]}
            for recipe in recipes if recipe["missingIngredients"]
        ],
    }
    prompt = (
        "For each recipe below, and each of its missing ingredients, suggest one food from "
        "userFoods that could replace it in that recipe. Use the food's name exactly as written "
        "in userFoods, or an empty string if nothing reasonable works.\n" + json.dumps(payload)
    )
    response = client.models.generate_content(
        model=SWAP_MODEL,
        contents=[prompt],
        config={
            "response_mime_type": "application/json",
            "response_json_schema": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "recipeId": {"type": "integer"},
                        "missing": {"type": "string"},
                        "swap": {"type": "string"},
                    },
                    "required": ["recipeId", "missing", "swap"],
                },
            },
        },
    )
    swaps = {}
    for item in json.loads(response.text):
        if item.get("swap"):
            swaps.setdefault(item["recipeId"], {})[item["missing"]] = item["swap"]
    return swaps


def valid_swaps(swaps, recipe, user_foods):
    # Keep a swap only for a real missing ingredient, pointing at one of the user's own foods
    by_name = {normalize_name(food): food for food in user_foods}
    return {
        missing: by_name[normalize_name(swap)]
        for missing, swap in swaps.items()
        if missing in recipe["missingIngredients"] and isinstance(swap, str) and normalize_name(swap) in by_name
    }


def detect_foods_with_gemini(images):
    # Send all photos in one request. Gemini answers with a JSON list of
    # {"label", "photo", "box_2d"}; box_2d is [ymin, xmin, ymax, xmax] on a 0-1000 scale.
    parts = []
    for index, image in enumerate(images):
        # Label each photo so Gemini can say which one a food is in
        parts.append(f"Photo {index}:")
        parts.append(types.Part.from_bytes(data=image.file.read(), mime_type=image.content_type))
    prompt = (
        "Detect every food item you can see in these photos. For each one, give its name, "
        "the number of the photo it's in, and its box_2d as [ymin, xmin, ymax, xmax] "
        "normalized to 0-1000. Use singular, lowercase, common names: 'egg' not 'eggs', "
        "'basil' not 'basil leaves', 'cheddar cheese' not 'Cheddar Cheese'."
    )
    config = {
        "response_mime_type": "application/json",
        "response_json_schema": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "photo": {"type": "integer"},
                    "box_2d": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["label", "photo", "box_2d"],
            },
        },
    }
    # The main model uses DETECT_RETRY; the fallback is a last resort, so no retry there.
    # Listing foods and boxes needs no reasoning, so each model gets its lowest thinking
    # level: 3.8 Flash's lowest is "low" ("minimal" is an error there); Flash-Lite has "minimal".
    attempts = [(GEMINI_MODEL, DETECT_RETRY, "low"), (SWAP_MODEL, None, "minimal")]
    for model, retry, thinking_level in attempts:
        http_options = {"timeout": DETECT_TIMEOUT_MS}
        if retry:
            http_options["retry_options"] = retry
        client = genai.Client(api_key=GEMINI_API_KEY, http_options=http_options)
        try:
            response = client.models.generate_content(
                model=model,
                contents=parts + [prompt],
                config={**config, "thinking_config": {"thinking_level": thinking_level}},
            )
        except Exception as error:
            if model == SWAP_MODEL or not gemini_overloaded(error):
                raise
            print(f"[detect] {model} unavailable ({error!r}), trying {SWAP_MODEL}", flush=True)
            continue
        print(f"[detect] answered by {model}", flush=True)
        return json.loads(response.text)


def gemini_overloaded(error):
    # 503 (overloaded), 504 / DEADLINE_EXCEEDED, or our own timeout: worth one try
    # with the fallback model
    if isinstance(error, genai_errors.ServerError) and error.code in (503, 504):
        return True
    return isinstance(error, (httpx.TimeoutException, TimeoutError)) or "Timeout" in type(error).__name__


def clean_detections(raw_detections, photo_count):
    # Keep food boxes only, with cleaned names, a real photo number and a box inside 0-1000
    detections = []
    for item in raw_detections:
        try:
            name = normalize_name(item["label"])
            photo = int(item["photo"])
            ymin, xmin, ymax, xmax = (min(max(float(value), 0), 1000) for value in item["box_2d"])
        except (KeyError, TypeError, ValueError):
            continue  # malformed item: skip it, keep the rest
        if not name or name in SKIPPED_INGREDIENTS or name in NON_FOOD or EQUIPMENT_WORDS.search(name):
            continue
        if not 0 <= photo < photo_count:
            continue
        ymin, ymax = sorted((ymin, ymax))
        xmin, xmax = sorted((xmin, xmax))
        detections.append({"name": name, "photo": photo, "box": [ymin, xmin, ymax, xmax]})
    return detections


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
    if name.endswith(" butter") and not name[:-len(" butter")].endswith(NOT_BUTTER):
        name = "butter"  # "unsalted butter" -> "butter", but not "peanut butter"
    if name.endswith(" oil") and not name[:-len(" oil")].endswith(NOT_OIL):
        name = "oil"  # "avocado oil" -> "oil", but not "sesame oil"
    if is_salt_or_pepper(name):
        name = "salt and pepper"  # a basic; "bell pepper" and "pepper jack" aren't
    return INGREDIENT_ALIASES.get(name, name)


def is_salt_or_pepper(name):
    # "kosher salt and ground pepper", "freshly ground black pepper", "salt to taste"
    words = [word for word in name.replace("to taste", " ").split() if word not in SALT_PEPPER_FILLER]
    return (
        bool(words)
        and all(word in SALT_PEPPER_WORDS for word in words)
        and ("salt" in words or "pepper" in words)
    )


def clean_ingredients(names):
    # The detected food list: no basics, kitchen supplies or equipment ("skillet"), no repeats
    cleaned = []
    for name in names:
        name = normalize_name(name)
        if (
            name
            and name not in SKIPPED_INGREDIENTS
            and name not in NON_FOOD
            and not EQUIPMENT_WORDS.search(name)
            and name not in cleaned
        ):
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
    # "cherry tomato" counts as "tomato", but "sundried tomato" and "potato" don't.
    # Works both ways: a user's "red bell pepper" covers a recipe's "bell pepper".
    for food in available:
        if name == food:
            return True
        if name.endswith(" " + food) and only_variety_words(name[:-len(food)]):
            return True
        if food.endswith(" " + name) and only_variety_words(food[:-len(name)]):
            return True
        # A more specific food covers the general one: user "chicken breast" -> recipe "chicken"
        if food.startswith(name + " ") and not set(food[len(name):].split()) & DIFFERENT_PRODUCT_WORDS:
            return True
    return False


def foods_used(recipe, available):
    # How many of the user's foods this recipe uses; each counts once, basics and pantry staples don't count
    names = [normalize_name(ingredient["name"]) for ingredient in recipe["ingredients"]]
    names = [
        name for name in names
        if name not in SKIPPED_INGREDIENTS and name not in PANTRY_STAPLES and name not in NON_FOOD
    ]
    return sum(
        1 for food in available
        if food not in SKIPPED_INGREDIENTS and food not in PANTRY_STAPLES
        and any(has_food(name, {food}) for name in names)
    )


def missing_ingredients(recipe, available):
    # Display names of the foods this recipe needs that the user doesn't have.
    # Basics (salt, oil, butter...), pantry staples (garlic, flour...), kitchen supplies and
    # equipment listed as an ingredient don't count.
    missing = []
    for ingredient in recipe["ingredients"]:
        name = normalize_name(ingredient["name"])
        if (
            name in SKIPPED_INGREDIENTS
            or name in PANTRY_STAPLES
            or name in NON_FOOD
            or EQUIPMENT_WORDS.search(name)
        ):
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


def fits_occasion(recipe, occasion):
    recipe_types = OCCASION_TYPES.get(occasion.strip().lower(), [])
    # Casual/unknown occasions, and sample recipes without dishTypes, aren't filtered
    if not recipe_types or "dishTypes" not in recipe:
        return True
    return any(dish_type in recipe_types for dish_type in recipe["dishTypes"])


def is_holiday_recipe(recipe):
    return any(occasion in HOLIDAY_OCCASIONS for occasion in recipe.get("occasions", []))




debug_dropped = {}  # DEBUG recipes: how many recipes each check dropped in this request


def fits_request(recipe, request):
    # Also records what's missing on the recipe, since the response shows it
    if not recipe["steps"]:
        debug_dropped["no steps"] = debug_dropped.get("no steps", 0) + 1  # DEBUG recipes
        print(f"[recipes]   dropped {recipe['title']!r}: no steps", flush=True)  # DEBUG recipes
        return False  # nothing to follow
    if not fits_occasion(recipe, request.occasion):
        debug_dropped["occasion"] = debug_dropped.get("occasion", 0) + 1  # DEBUG recipes
        print(f"[recipes]   dropped {recipe['title']!r}: occasion (dishTypes={recipe.get('dishTypes')})", flush=True)  # DEBUG recipes
        return False
    selected = {appliance.strip().lower() for appliance in request.appliances}
    # No appliances selected means the user didn't say, so don't filter by them
    if selected and not needs_only_selected_appliances(recipe, selected):
        debug_dropped["appliances"] = debug_dropped.get("appliances", 0) + 1  # DEBUG recipes
        print(f"[recipes]   dropped {recipe['title']!r}: appliances (equipment={recipe['appliances']})", flush=True)  # DEBUG recipes
        return False
    available = {normalize_name(name) for name in request.ingredients}
    recipe["missingIngredients"] = missing_ingredients(recipe, available)
    if len(recipe["missingIngredients"]) > MAX_MISSING_INGREDIENTS:
        debug_dropped["too many missing"] = debug_dropped.get("too many missing", 0) + 1  # DEBUG recipes
        print(f"[recipes]   dropped {recipe['title']!r}: too many missing ({len(recipe['missingIngredients'])}): {recipe['missingIngredients']}", flush=True)  # DEBUG recipes
        return False
    return True


@app.post("/api/detect-ingredients")
def detect_ingredients(images: list[UploadFile] = File(...)):
    global detect_count
    # Check uploads first, so bad ones never reach Gemini (and work without a key)
    if len(images) > MAX_PHOTOS:
        return upload_error("too_many_photos", "Please upload up to 5 photos.")
    for image in images:
        if not (image.content_type or "").startswith("image/"):
            return upload_error("not_an_image", "Only image files can be uploaded.")
    for image in images:
        if photo_too_large(image):
            return upload_error("photo_too_large", "Each photo must be under 5 MB.")

    # No key means local testing: use sample data instead of calling Gemini
    if not GEMINI_API_KEY:
        # No boxes for sample data, so the Review step shows just the list
        return {**load_sample("detect_ingredients.json"), "detections": []}
    if daily_detect_limit_reached():
        return daily_detect_limit_response()
    detect_count += 1
    try:
        raw = detect_foods_with_gemini(images)
        labels = [item["label"] for item in raw if isinstance(item, dict) and isinstance(item.get("label"), str)]
        return {
            "ingredients": clean_ingredients(labels),
            "detections": clean_detections(raw, len(images)),
        }
    except Exception as error:  # 503, quota/429, timeout, bad JSON, anything else
        print(f"[detect] photo detection failed: {error!r}", flush=True)
        return detect_unavailable_response()


@app.post("/api/recipes")
def get_recipes(request: RecipeRequest):
    if USE_CAPTURE:
        # Replay a saved Spoonacular response: no API call, no quota, not counted
        if not CAPTURE_FILE.exists():
            raise RuntimeError(f"USE_CAPTURE=1 but {CAPTURE_FILE} doesn't exist yet; run one search with SAVE_SPOONACULAR=1 first")
        print(f"[capture] using saved Spoonacular response from {CAPTURE_FILE}", flush=True)
        data = json.loads(CAPTURE_FILE.read_text())
        recipes = [format_recipe(raw) for raw in data["results"]]
    # No key means local testing: use sample data and skip the daily limit
    elif not SPOONACULAR_API_KEY:
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

    debug_dropped.clear()  # DEBUG recipes
    debug_left = len(recipes)  # DEBUG recipes
    print(f"[recipes] {debug_left} recipes before filtering (occasion={request.occasion!r}, appliances={request.appliances})", flush=True)  # DEBUG recipes
    recipes = [recipe for recipe in recipes if fits_request(recipe, request)]
    for debug_reason in ("no steps", "occasion", "appliances", "too many missing"):  # DEBUG recipes
        debug_left -= debug_dropped.get(debug_reason, 0)  # DEBUG recipes
        print(f"[recipes] after {debug_reason} check: {debug_left} left (dropped {debug_dropped.get(debug_reason, 0)})", flush=True)  # DEBUG recipes

    # For "holiday", recipes tagged with a holiday come first. Then fewest missing
    # foods, then the ones using most of the user's foods, then quickest;
    # recipes without a time go last
    holiday = request.occasion.strip().lower() == "holiday"
    available = {normalize_name(name) for name in request.ingredients}
    recipes.sort(key=lambda recipe: (
        holiday and not is_holiday_recipe(recipe),
        len(recipe["missingIngredients"]),
        -foods_used(recipe, available),
        recipe["readyInMinutes"] is None,
        recipe["readyInMinutes"] or 0,
    ))
    recipes = recipes[:5]
    print(f"[recipes] returning {len(recipes)}: {[recipe['title'] for recipe in recipes]}", flush=True)  # DEBUG recipes

    for recipe in recipes:
        # Swaps load separately from POST /api/swaps, so recipes never wait for Gemini
        recipe["swaps"] = {}
        scale_servings(recipe, request.servings)

    return {"recipes": recipes}


class SwapRecipe(BaseModel):
    id: int
    title: str
    missingIngredients: list[str]


class SwapRequest(BaseModel):
    ingredients: list[str]
    recipes: list[SwapRecipe]


@app.post("/api/swaps")
def get_swaps(request: SwapRequest):
    # Swaps are a bonus: any problem (no key match, limit, Gemini error) just means no swaps
    global swap_count
    recipes = [recipe.model_dump() for recipe in request.recipes if recipe.missingIngredients]
    if not recipes:
        return {"swaps": {}}
    if not GEMINI_API_KEY:
        # Local testing: sample recipes can carry example swaps
        sample = {recipe["id"]: recipe.get("swaps", {}) for recipe in load_sample("recipes.json")["recipes"]}
        suggested = {recipe["id"]: sample.get(recipe["id"], {}) for recipe in recipes}
    else:
        if daily_swap_limit_reached():
            return {"swaps": {}}
        swap_count += 1
        try:
            suggested = suggest_swaps_with_gemini(recipes, request.ingredients)
        except Exception as error:  # network, timeout, quota or bad JSON
            print(f"[swaps] Gemini swap suggestions failed: {error!r}", flush=True)
            return {"swaps": {}}

    swaps = {}
    for recipe in recipes:
        valid = valid_swaps(suggested.get(recipe["id"], {}), recipe, request.ingredients)
        if valid:
            swaps[recipe["id"]] = valid
    return {"swaps": swaps}
