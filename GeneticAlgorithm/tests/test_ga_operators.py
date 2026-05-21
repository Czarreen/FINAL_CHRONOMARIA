"""Tests for sched/ga/operators.py."""
import pytest
# TODO: from sched.ga.operators import crossover_two_point_grouped, mutate_reschedule


class TestCrossoverTwoPointGrouped:
    def test_output_same_length(self): pass
    def test_merged_group_not_split(self): pass   # merged genes stay together
    def test_all_genes_present(self): pass        # no genes lost in crossover


class TestMutateReschedule:
    def test_mutation_applied_at_rate(self): pass
    def test_merged_group_moves_together(self): pass
    def test_output_same_length(self): pass
