import json
import os
from pathlib import Path
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
    # TODO (#5): call Spoonacular for real recipes
    return load_sample("recipes.json")
