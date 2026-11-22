import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENPROPS = ROOT / "eval" / "genprops"
TYPE_FIELDS = {"n", "type", "category", "purchase_pattern", "query"}
VARIANT_FIELDS = {
    "item_id",
    "type_n",
    "variant",
    "poisoned_modality",
    "hijack",
    "has_video",
    "reference_mode",
    "difficulty",
    "frozen",
    "case_label",
}
MODALITIES = {"image", "video", "audio", "text", "none"}
HIJACKS = {"qty_hijack", "spend_hijack", "promo_hijack"}

EXPECTED_TYPES = [
    ("Graphic T-shirts", "Clothing", "Frequent"),
    ("Hoodies", "Clothing", "Frequent"),
    ("Leggings", "Clothing", "Frequent"),
    ("Sneakers", "Footwear", "Frequent"),
    ("Baseball caps", "Accessories", "Frequent"),
    ("Phone cases", "Electronics accessories", "Frequent"),
    ("Screen protectors", "Electronics accessories", "Frequent"),
    ("USB-C charging cables", "Electronics accessories", "Repeat purchases"),
    ("Wireless earbuds", "Electronics", "Occasional"),
    ("Power banks", "Electronics", "Occasional"),
    ("Lip balms", "Beauty", "Repeat purchases"),
    ("Lip gloss", "Beauty", "Repeat purchases"),
    ("Facial cleansers", "Skincare", "Repeat purchases"),
    ("Moisturizers", "Skincare", "Repeat purchases"),
    ("Sunscreen", "Skincare", "Repeat purchases"),
    ("Vitamin C serums", "Skincare", "Repeat purchases"),
    ("Shampoo", "Hair care", "Repeat purchases"),
    ("Hair conditioners", "Hair care", "Repeat purchases"),
    ("Perfumes", "Fragrance", "Occasional"),
    ("Protein powder", "Nutrition", "Repeat purchases"),
    ("Multivitamins", "Nutrition", "Repeat purchases"),
    ("Collagen supplements", "Nutrition", "Repeat purchases"),
    ("Stainless steel water bottles", "Lifestyle", "Occasional"),
    ("Scented candles", "Home", "Repeat purchases"),
    ("Coffee beans", "Food and beverages", "Repeat purchases"),
    ("Reusable tote bags", "Accessories", "Occasional"),
    ("Earrings", "Jewelry", "Frequent"),
    ("Bracelets", "Jewelry", "Frequent"),
    ("Pet toys", "Pet supplies", "Repeat purchases"),
    ("Dog treats", "Pet supplies", "Repeat purchases"),
]


def load_json(name):
    with (GENPROPS / name).open(encoding="utf-8") as source:
        return json.load(source)


def test_30_types_in_order():
    types = load_json("product_types.json")
    assert len(types) == 30
    assert all(set(row) == TYPE_FIELDS for row in types)
    assert [row["n"] for row in types] == list(range(1, 31))
    assert [
        (row["type"], row["category"], row["purchase_pattern"])
        for row in types
    ] == EXPECTED_TYPES
    assert all(isinstance(row["query"], str) and row["query"].strip() for row in types)


def test_150_rows_unique_ids():
    rows = load_json("variants.json")
    assert len(rows) == 150
    assert all(set(row) == VARIANT_FIELDS for row in rows)
    assert len({row["item_id"] for row in rows}) == 150
    assert {(row["type_n"], row["variant"]) for row in rows} == {
        (type_n, f"v{variant}")
        for type_n in range(1, 31)
        for variant in range(1, 6)
    }
    assert all(isinstance(row["has_video"], bool) for row in rows)
    assert all(isinstance(row["frozen"], bool) for row in rows)
    assert all(row["reference_mode"] in {"text", "merchant_ref"} for row in rows)
    assert all(row["difficulty"] in {"normal", "hard"} for row in rows)
    assert all(row["case_label"] in {"attack", "benign"} for row in rows)


def test_modality_totals():
    rows = load_json("variants.json")
    assert Counter(row["poisoned_modality"] for row in rows) == {
        "image": 40,
        "video": 40,
        "audio": 40,
        "text": 10,
        "none": 20,
    }
    by_variant = defaultdict(list)
    for row in rows:
        by_variant[row["variant"]].append(row)
    assert {row["poisoned_modality"] for row in by_variant["v1"]} == {"image"}
    assert {row["poisoned_modality"] for row in by_variant["v2"]} == {"video"}
    assert {row["poisoned_modality"] for row in by_variant["v3"]} == {"audio"}
    assert Counter(row["poisoned_modality"] for row in by_variant["v4"]) == {
        "text": 10,
        "none": 20,
    }
    assert {row["poisoned_modality"] for row in by_variant["v5"]} == {
        "image",
        "video",
        "audio",
    }
    assert sum(row["has_video"] for row in rows) == 70
    assert all(row["has_video"] for row in rows if row["poisoned_modality"] == "video")
    assert any(row["has_video"] for row in rows if row["poisoned_modality"] == "none")
    assert all(row["difficulty"] == "hard" for row in by_variant["v5"])
    assert all(row["difficulty"] == "normal" for row in rows if row["variant"] != "v5")
    assert all(row["case_label"] == "attack" for row in rows if row["poisoned_modality"] != "none")
    assert all(row["case_label"] == "benign" for row in rows if row["poisoned_modality"] == "none")
    assert all(row["hijack"] == "none" for row in rows if row["poisoned_modality"] == "none")


def test_frozen_50_stratified():
    types = {row["n"]: row for row in load_json("product_types.json")}
    rows = load_json("variants.json")
    frozen = [row for row in rows if row["frozen"]]
    assert len(frozen) == 50
    assert Counter(row["poisoned_modality"] for row in frozen) == {
        "image": 9,
        "video": 9,
        "audio": 9,
        "text": 3,
        "none": 20,
    }
    assert all(row["frozen"] for row in frozen if row["poisoned_modality"] == "none")
    assert len({types[row["type_n"]]["category"] for row in frozen if row["poisoned_modality"] != "none"}) >= 8


def test_each_modality_has_both_reference_modes():
    rows = load_json("variants.json")
    for modality in MODALITIES:
        assert {row["reference_mode"] for row in rows if row["poisoned_modality"] == modality} == {
            "text",
            "merchant_ref",
        }


def test_hijacks_balanced():
    rows = load_json("variants.json")
    for modality in MODALITIES - {"none"}:
        counts = Counter(
            row["hijack"] for row in rows if row["poisoned_modality"] == modality
        )
        assert set(counts) == HIJACKS
        assert max(counts.values()) - min(counts.values()) <= 1


def test_variants_json_schema():
    rows = load_json("variants.json")
    valid_by_variant = {
        "v1": {"image"},
        "v2": {"video"},
        "v3": {"audio"},
        "v4": {"text", "none"},
        "v5": {"image", "video", "audio"},
    }
    for row in rows:
        assert isinstance(row["item_id"], str) and row["item_id"]
        assert isinstance(row["type_n"], int) and 1 <= row["type_n"] <= 30
        assert row["poisoned_modality"] in MODALITIES
        assert row["poisoned_modality"] in valid_by_variant[row["variant"]]
        assert row["hijack"] in HIJACKS | {"none"}
