"""Shared pytest fixtures."""
import pytest
import json
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def eng_math_gpic_case():
    """The original bug: same section + overlapping rooms + overlapping times."""
    with open(FIXTURES / "eng_math_gpic_conflict.json") as f:
        return json.load(f)


@pytest.fixture
def small_master_list():
    with open(FIXTURES / "sample_master_list_small.json") as f:
        return json.load(f)


@pytest.fixture
def full_master_list_359():
    """The 359-subject case that previously dropped to 345."""
    with open(FIXTURES / "sample_master_list_full.json") as f:
        return json.load(f)
