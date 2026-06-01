import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from optimizer import match_specialization_score


def test_specialization_matches_full_phrase_but_not_embedded_word():
    faculty = {
        "faculty_id": 1,
        "faculty_specialization": "Programming, Social and Professional Issues in CS",
    }

    full_title_offering = {
        "code": "CS",
        "course_no": "101",
        "descriptive_title": "Social and Professional Issues in CS",
    }
    embedded_word_offering = {
        "code": "CS",
        "course_no": "101",
        "descriptive_title": "Professional",
    }
    single_word_offering = {
        "code": "CS",
        "course_no": "101",
        "descriptive_title": "Programming",
    }

    assert match_specialization_score(faculty, full_title_offering, None, None) > 0
    assert match_specialization_score(faculty, single_word_offering, None, None) > 0
    assert match_specialization_score(faculty, embedded_word_offering, None, None) == 0
