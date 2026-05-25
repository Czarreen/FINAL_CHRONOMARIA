#!/usr/bin/env python3
"""Find keyword overlaps between `faculty_specialization` and course titles.

Usage: python match_specialization_keywords.py [path/to/ga_last_run.json]
Prints a JSON array of matches with intersecting keywords.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path
from typing import List, Dict, Set


SPECIALIZATION_STOP_WORDS = {
    'AND',
    'THE',
    'OF',
    'IN',
    'ON',
    'FOR',
    'TO',
    'A',
    'AN',
    'BY',
    'WITH',
    'IS',
    'ARE',
    'FROM',
    'AT',
    'AS',
    'OR',
    'DESIGN',
    'ANALYSIS',
    'ENGINEERING',
    'ENGINEER',
    'SYSTEM',
    'SYSTEMS',
    'TECHNOLOGY',
    'TECHNOLOGIES',
    'METHOD',
    'METHODS',
    'PROJECT',
    'PROJECTS',
    'RESEARCH',
    'STUDY',
    'STUDIES',
    'INTRODUCTION',
    'INTRODUCTORY',
    'FUNDAMENTAL',
    'FUNDAMENTALS',
    'CAPSTONE',
    'PRACTICE',
    'APPLICATION',
    'APPLICATIONS',
    'ADVANCED',
    'SPECIALIZATION',
}

SPECIALIZATION_SYNONYMS = {
    'ARCHITECTURAL': 'ARCHITECTURE',
    'ARCHITECTURE': 'ARCHITECTURE',
    'MATHEMATICS': 'MATH',
    'MATH': 'MATH',
    'STATISTICS': 'STATISTICS',
    'STATISTICAL': 'STATISTICS',
}


def tokenize(text: str, min_len: int = 3) -> Set[str]:
    if not text:
        return set()
    out: Set[str] = set()
    for token in re.split(r"[,;/|]+", text.upper()):
        for part in re.split(r"\s+", token.replace('&', ' ')):
            clean = re.sub(r"[^A-Za-z0-9]", "", part).upper()
            if len(clean) < min_len or clean in SPECIALIZATION_STOP_WORDS:
                continue
            out.add(SPECIALIZATION_SYNONYMS.get(clean, clean))
    return out


def analyze(runfile: str) -> List[Dict]:
    p = Path(runfile)
    data = json.loads(p.read_text(encoding='utf-8'))
    results = []
    for a in data.get('assignments', []):
        fac = a.get('faculty', {})
        fid = fac.get('faculty_id')
        fname = fac.get('faculty_name')
        spec = fac.get('faculty_specialization') or ''

        offering = a.get('offering', {})
        title = offering.get('descriptive_title') or offering.get('code') or ''
        matched = a.get('matched_subject', {})
        matched_title = matched.get('subject_descriptive_title') or ''

        spec_tokens = tokenize(spec)
        title_tokens = tokenize(title)
        matched_tokens = tokenize(matched_title)

        overlap_title = sorted(list(spec_tokens & title_tokens))
        overlap_matched = sorted(list(spec_tokens & matched_tokens))

        results.append({
            'faculty_id': fid,
            'faculty_name': fname,
            'faculty_specialization': spec,
            'offering_title': title,
            'matched_title': matched_title,
            'overlap_with_offering': overlap_title,
            'overlap_with_matched': overlap_matched,
            'overlap_count': len(overlap_title) + len(overlap_matched)
        })
    return results


def main(argv=None):
    argv = argv or sys.argv[1:]
    path = argv[0] if argv else 'GeneticAlgorithm/ga_last_run.json'
    out = analyze(path)
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
