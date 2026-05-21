"""
DEAP toolbox setup and main GA loop.

Chromosome: List[Gene] where Gene = (pattern_idx, start_min, day1_room_idx, day2_room_idx).
LOCKED subjects are not in the chromosome. Resolved baseline is a read-only constraint.
"""

import random
import time
import functools
from typing import List, Dict

from deap import base, creator, tools

from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.common import Gene, section_key, decode_chromosome
from sched.ga.initialization import seeded_population, random_chromosome
from sched.ga.fitness import evaluate
from sched.ga.operators import crossover_two_point_grouped, mutate_reschedule
from sched.ga.repair import repair

# Guard against re-creation on repeated imports (DEAP uses global state)
if not hasattr(creator, 'FitnessMax'):
    creator.create('FitnessMax', base.Fitness, weights=(1.0,))
if not hasattr(creator, 'Individual'):
    creator.create('Individual', list, fitness=creator.FitnessMax)


def build_toolbox(
    subjects: List[Subject],
    rooms: List[Room],
    rng: random.Random,
) -> base.Toolbox:
    """Build a DEAP toolbox with evaluate/mate/mutate/select registered."""
    toolbox = base.Toolbox()

    toolbox.register(
        'individual',
        tools.initIterate,
        creator.Individual,
        lambda: random_chromosome(subjects, rooms, rng),
    )
    toolbox.register('population', tools.initRepeat, list, toolbox.individual)
    toolbox.register('evaluate', evaluate, subjects=subjects, rooms=rooms)
    toolbox.register(
        'mate',
        lambda a, b: crossover_two_point_grouped(a, b, subjects=subjects, rng=rng),
    )
    toolbox.register(
        'mutate',
        lambda ind: mutate_reschedule(ind, subjects=subjects, rooms=rooms, rng=rng),
    )
    toolbox.register('select', tools.selTournament, tournsize=3)

    return toolbox


def run_ga_optimization(
    pending: List[Subject],
    resolved: List[Subject],
    rooms: List[Room],
    constraints: dict = None,
) -> List[Subject]:
    """
    Run the GA on the pending subjects against the resolved baseline.

    Returns decoded List[Subject] with schedule fields set.
    CRITICAL: len(output) == len(pending) always.
    """
    if not pending or not rooms:
        return list(pending)

    constraints = constraints or {}
    seed      = int(constraints.get('random_seed', 42))
    pop_size  = max(8, int(constraints.get('population_size', 120)))
    max_gen   = max(1, int(constraints.get('max_generations', 250)))
    mut_rate  = float(constraints.get('mutation_rate', 0.07))
    cx_rate   = float(constraints.get('crossover_rate', 0.85))
    max_secs  = float(constraints.get('max_runtime_seconds', 45.0))

    rng     = random.Random(seed)
    started = time.perf_counter()

    # Precompute section indices for crossover (avoids rebuilding every call)
    sec_indices: Dict[str, List[int]] = {}
    for i, s in enumerate(pending):
        sec_indices.setdefault(section_key(s), []).append(i)

    # Warm-start population
    population: List[List[Gene]] = seeded_population(pending, rooms, rng, pop_size)
    population = [list(c) for c in population]

    best     = population[0]
    best_fit = evaluate(best, subjects=pending, rooms=rooms)[0]
    stagnation = 0

    while (time.perf_counter() - started) < max_secs:
        scored = [
            (evaluate(c, subjects=pending, rooms=rooms)[0], c)
            for c in population
        ]
        scored.sort(key=lambda x: (x[0] != float('-inf'), x[0]), reverse=True)

        top_fit, top_chrom = scored[0]
        if top_fit > best_fit or best_fit == float('-inf'):
            best_fit = top_fit
            best     = top_chrom
            stagnation = 0
        else:
            stagnation += 1

        if stagnation >= 40 or best_fit >= 99.5:
            break

        elite_n  = max(3, pop_size // 4)
        elites   = [c for _, c in scored[:elite_n]]
        next_pop = [list(c) for c in elites]

        while len(next_pop) < pop_size:
            pa = rng.choice(elites)
            if rng.random() < cx_rate:
                pb = rng.choice(elites)
                child, _ = crossover_two_point_grouped(pa, pb, subjects=pending, rng=rng, section_indices=sec_indices)
            else:
                child = list(pa)
            child = mutate_reschedule(child, subjects=pending, rooms=rooms, rng=rng, mutation_rate=mut_rate)
            next_pop.append(child)

        population = next_pop

    # Post-GA repair
    time_remaining = max_secs - (time.perf_counter() - started)
    if time_remaining > 2.0:
        repair_budget = min(time_remaining - 1.0, 12.0)
        repaired = repair(best, subjects=pending, rooms=rooms, rng=rng,
                          max_passes=5, time_limit_s=repair_budget)
        rep_fit = evaluate(repaired, subjects=pending, rooms=rooms)[0]
        if rep_fit > best_fit or best_fit == float('-inf'):
            best = repaired

    decoded = decode_chromosome(best, pending, rooms)
    assert len(decoded) == len(pending), (
        f"GA output size mismatch: {len(decoded)} != {len(pending)}"
    )
    return decoded
