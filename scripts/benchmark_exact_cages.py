"""Compare exact-cage/loop changes with an unmodified baseline worktree.

Run from the modified checkout:
    python scripts/benchmark_exact_cages.py --baseline-root /path/to/baseline
Uses fresh interpreters per case, complete profiles, exact solution fingerprints,
root deduction fingerprints, and a count of real backtracking nodes. No solver
profile, action queue, max-solutions behaviour, or runtime policy is patched.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time


CASES = ('sudoku4', 'killer-hard', 'killer-deadly', 'slitherlink2', 'slitherlink3')
BASELINE = '69b662087b896b864d6bb93b180d9c8f13c975a8'


def fingerprint(value):
    return hashlib.sha256(repr(value).encode()).hexdigest()


def child(root, case):
    sys.path.insert(0, str(root))
    from gridsolver.abstract_grids.grid_loading import create_from_file
    from gridsolver.grid_classes.slitherlink import Slitherlink
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.rules.sumrules import SumAndElementsAtMostOnce
    from gridsolver.solver.atomic_solver import AtomicSolver
    from gridsolver.solver import solver
    if case == 'sudoku4':
        grid = Sudoku(2, 2, 2, 2)
    elif case == 'killer-hard':
        grid = create_from_file(root / 'Examples/KillerSudoku/20201001_hard290.pzl')
    elif case == 'killer-deadly':
        grid = create_from_file(root / 'Examples/KillerSudoku/20230918_times_deadly.pzl')
    else:
        side = 2 if case == 'slitherlink2' else 3
        grid = Slitherlink([[None] * side for _ in range(side)])
    # Root deductions are compared independently of eventual solution sets.
    probe = grid.deepcopy()
    status = AtomicSolver(probe, [], set()).solve_atomic()
    root_signature = (status.name, probe.known, tuple(tuple(sorted(c)) for c in probe._candidates),
                      tuple(sorted((g.val, tuple(sorted(g.cells))) for g in probe.guarantees)))
    calls = 0
    original = solver._atomic_pass_or_branches
    def counted(*args, **kwargs):
        nonlocal calls
        result = original(*args, **kwargs)
        if result[0] is None:
            calls += 1
        return result
    solver._atomic_pass_or_branches = counted
    SumAndElementsAtMostOnce._partition_tuples.cache_clear()
    start = time.perf_counter()
    solutions = solver.solve(grid)
    elapsed = time.perf_counter() - start
    print(json.dumps({'seconds': elapsed, 'solutions': len(solutions),
                      'solution_sha256': fingerprint(sorted(tuple(s) for s in solutions)),
                      'root_sha256': fingerprint(root_signature), 'branch_nodes': calls}))


def loop_differential(root, baseline):
    sys.path.insert(0, str(root))
    from itertools import combinations, product
    from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
    from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
    from gridsolver.rules.topology import SingleLoopRule
    spec = importlib.util.spec_from_file_location('review2_baseline_topology',
                                                baseline / 'gridsolver/rules/topology.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    edges = tuple(combinations(range(5), 2))
    size = GridSizeContainer(1, len(edges), 2)
    old = module.SingleLoopRule(size, range(len(edges)), edges)
    new = SingleLoopRule(size, range(len(edges)), edges)
    def outcome(rule, state):
        candidates = tuple({1} if x == 0 else {2} if x == 2 else {1, 2} for x in state)
        try:
            rule.apply([0] * len(edges), candidates)
            status = 'live'
        except InvalidGrid:
            return ('invalid',)
        except RuleAlwaysSatisfied:
            status = 'satisfied'
        return status, candidates
    count = 0
    for state in product((0, 1, 2), repeat=len(edges)):
        assert outcome(old, state) == outcome(new, state), state
        count += 1
    return count


def micro(root):
    sys.path.insert(0, str(root))
    from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
    from gridsolver.rules.sumrules import SumAndElementsAtMostOnce
    from gridsolver.grid_classes.cage_loading import _product_target_is_possible
    from math import factorial
    result = {}
    for n in (9, 16, 25, 100):
        samples = []
        for _ in range(5):
            SumAndElementsAtMostOnce._partition_tuples.cache_clear()
            rule = SumAndElementsAtMostOnce(GridSizeContainer(1, n, n), range(n), n*(n+1)//2)
            start = time.perf_counter()
            assert rule.sum_candidates == (frozenset(range(1, n+1)),)
            samples.append(time.perf_counter()-start)
        result[f'full-domain-{n}'] = {'seconds': samples, 'median_seconds': statistics.median(samples), 'partitions': 1}
    for n in (20, 25):
        _product_target_is_possible.cache_clear()
        start = time.perf_counter()
        assert _product_target_is_possible(n*n, n, factorial(n)**n)
        result[f'product-{n}'] = {'seconds': time.perf_counter()-start}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-root', type=Path)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--case', choices=CASES)
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--output', type=Path, default=Path('benchmarks/exact_cages_2026-09-06.json'))
    args = parser.parse_args()
    if args.case:
        child(args.root.resolve(), args.case)
        return
    root = Path(__file__).resolve().parents[1]
    if args.baseline_root is None or args.samples < 1:
        parser.error('--baseline-root and a positive --samples are required')
    baseline = args.baseline_root.resolve()
    report = {'python': sys.version, 'baseline': BASELINE, 'samples': args.samples,
              'timing_note': 'Three fresh-interpreter samples per mode; compare medians, not a claim of universal speedup.',
              'cases': {}, 'micro': micro(root)}
    report['loop_states_equivalent'] = loop_differential(root, baseline)
    print('Identical complete loop-rule outcomes on', report['loop_states_equivalent'], 'states.', flush=True)
    script = Path(__file__).resolve()
    for case in CASES:
        results = {'before': [], 'after': []}
        for sample in range(args.samples):
            # Alternate run order to reduce warmup/runner-load bias.
            modes = ('before', 'after') if sample % 2 == 0 else ('after', 'before')
            for mode in modes:
                source = baseline if mode == 'before' else root
                env = {k:v for k,v in os.environ.items() if k != 'PYTHONPATH'}
                env['PYTHONHASHSEED'] = '0'
                run = subprocess.run([sys.executable, str(script), '--root', str(source), '--case', case],
                                     cwd=source, env=env, capture_output=True, text=True, timeout=180, check=True)
                results[mode].append(json.loads(run.stdout.splitlines()[-1]))
        identity = ('solutions', 'solution_sha256', 'root_sha256', 'branch_nodes')
        expected = tuple(results['before'][0][k] for k in identity)
        assert all(tuple(result[k] for k in identity) == expected
                   for samples in results.values() for result in samples), (case, results)
        for mode in results:
            results[mode] = {'samples': results[mode],
                             'median_seconds': statistics.median(r['seconds'] for r in results[mode])}
        report['cases'][case] = results
        print(case, json.dumps(results), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
