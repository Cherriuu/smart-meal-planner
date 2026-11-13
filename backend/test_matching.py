# Checks for ingredient matching (has_food / missing_ingredients). No API calls.
# Run from backend/:  python test_matching.py
import os

# Blank keys so importing main never uses real API keys
os.environ["SPOONACULAR_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""

from main import has_food, missing_ingredients, normalize_name  # noqa: E402


def covered(recipe_ingredient, user_foods):
    # Same normalizing on both sides, like the real recipe filter
    return has_food(normalize_name(recipe_ingredient), {normalize_name(food) for food in user_foods})


USER = ["chicken breast", "cheddar cheese", "tomato", "rice", "ground beef", "milk", "egg"]

# Recipe ingredients this user does have
SHOULD_MATCH = [
    "chicken",
    "boneless skinless chicken breast",
    "shredded cheddar cheese",
    "cheddar",
    "diced tomatoes",
    "long grain rice",
    "cooked rice",
    "jasmine rice",
    "lean ground beef",
    "whole milk",
    # still working from before
    "cherry tomatoes",
    "eggs",
    "large eggs",
    "extra lean ground beef",
    "basmati rice",
    "low fat milk",
]

# (recipe ingredient, user foods) pairs that must NOT match
SHOULD_NOT_MATCH = [
    ("butter", ["peanut butter"]),
    ("peanut butter", ["butter"]),
    ("potato", ["sweet potato"]),
    ("sweet potato", ["potato"]),
    ("tomato", ["sundried tomato"]),
    ("sundried tomato", ["tomato"]),
    ("tomato", ["potato"]),
    ("cheese", ["cheddar cheese"]),
    ("chicken", ["chicken broth"]),
    ("tomato", ["tomato sauce"]),
    ("egg", ["egg noodles"]),
    ("rice", ["rice vinegar"]),
    ("peanut", ["peanut butter"]),
    ("corn", ["corn tortillas"]),
    ("egg", ["cadbury eggs"]),
    ("chicken thigh", ["chicken breast"]),
    ("feta cheese", USER),
]

failures = []
for ingredient in SHOULD_MATCH:
    if not covered(ingredient, USER):
        failures.append(f"should match but doesn't: {ingredient!r} for {USER}")
for ingredient, foods in SHOULD_NOT_MATCH:
    if covered(ingredient, foods):
        failures.append(f"matches but shouldn't: {ingredient!r} for {foods}")

# The whole recipe: only the foods the user really lacks are missing
recipe = {"ingredients": [{"name": name} for name in SHOULD_MATCH + ["feta cheese", "sweet potato"]]}
missing = missing_ingredients(recipe, {normalize_name(food) for food in USER})
if missing != ["feta cheese", "sweet potato"]:
    failures.append(f"missing_ingredients gave {missing}, expected ['feta cheese', 'sweet potato']")

for failure in failures:
    print("FAIL:", failure)
assert not failures, f"{len(failures)} matching check(s) failed"
print(f"All {len(SHOULD_MATCH) + len(SHOULD_NOT_MATCH) + 1} matching checks passed")
