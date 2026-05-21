"""Tests for sched/ga/fitness.py."""
import pytest
# TODO: from sched.ga.fitness import evaluate, count_hard_conflicts, soft_score


class TestCountHardConflicts:
    def test_no_conflicts(self): pass
    def test_internal_conflict(self): pass        # conflict within individual
    def test_vs_resolved_conflict(self): pass     # individual conflicts with resolved
    def test_compound_room_conflict(self): pass


class TestEvaluate:
    def test_hard_conflict_returns_neg_inf(self): pass
    def test_clean_individual_returns_positive(self): pass
    def test_tuple_output(self): pass             # DEAP requires tuple


class TestSoftScore:
    def test_returns_float(self): pass
    def test_higher_is_better(self): pass         # better spread -> higher score
