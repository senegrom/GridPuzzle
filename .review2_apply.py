"""One-time, source-anchored migration; removed before merging."""
import ast
from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one source anchor, found {text.count(old)}')
    p.write_text(text.replace(old, new), encoding='utf-8')


def method(path, cls, name, replacement):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    tree = ast.parse(text)
    container = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls)
    node = next(n for n in container.body if isinstance(n, ast.FunctionDef) and n.name == name)
    start = min([node.lineno, *(d.lineno for d in node.decorator_list)]) - 1
    lines = text.splitlines(keepends=True)
    p.write_text(''.join(lines[:start]) + replacement + ''.join(lines[node.end_lineno:]), encoding='utf-8')


SUM = 'gridsolver/rules/sumrules.py'
method(SUM, 'SumAndElementsAtMostOnce', 'sum_candidates', '''    @cached_property
    def sum_candidates(self) -> Tuple[FrozenSet[int]]:
        # Exact staircase bijection: x[0] < ... < x[k-1] in 1..M iff
        # y[i] = x[i] - i is nondecreasing in 1..M-k+1. The sum falls
        # by k*(k-1)//2. Generate only admissible distinct partitions;
        # do not approximate or defer the full matching/guarantee filter.
        count = self.len_cells
        staircase = count * (count - 1) // 2
        return tuple(
            frozenset(value + index for index, value in enumerate(partition))
            for partition in self._partition_tuples(
                self.sum - staircase,
                count,
                1,
                self._max_elem - count + 1,
            )
        )
''')
replace(SUM, '''        if maxi < mini or count <= 0:
            return ()
        if count == 1:
            return ((n,),) if mini <= n <= maxi else ()
''', '''        if maxi < mini or count <= 0 or not count * mini <= n <= count * maxi:
            return ()
        # These exact extrema have one partition, including large full-domain
        # distinct cages after the staircase transform. Avoid recursive depth
        # proportional to the cage size when the answer is already determined.
        if n == count * mini:
            return ((mini,) * count,)
        if n == count * maxi:
            return ((maxi,) * count,)
        if count == 1:
            return ((n,),)
''')

SIZE = 'gridsolver/abstract_grids/gridsize_container.py'
replace(SIZE, 'class GridSizeContainer:\n', '''_SIZE_FIELDS = frozenset(("rows", "cols", "max_elem", "len"))


class GridSizeContainer:
    # Keep the existing dictionary layout (including pickle/clone format) and
    # direct attribute reads on solver hot paths. Only initial assignment of
    # size metadata is allowed; mutable Grid values do not imply mutable shape.
    def __setattr__(self, name: str, value: object) -> None:
        if name in _SIZE_FIELDS and name in self.__dict__:
            raise AttributeError(f"{name} is read-only after construction")
        object.__setattr__(self, name, value)

    def __delattr__(self, name: str) -> None:
        if name in _SIZE_FIELDS:
            raise AttributeError(f"{name} is read-only after construction")
        object.__delattr__(self, name)

''')

CAGE = 'gridsolver/grid_classes/cage_loading.py'
p = Path(CAGE)
text = p.read_text(encoding='utf-8')
a = text.index('@lru_cache(maxsize=65535)\ndef _product_target_is_possible(')
b = text.index('\n\ndef parse_kenken_dictionary(', a)
text = text[:a] + '''@lru_cache(maxsize=65535)
def _product_target_is_possible(
    cage_size: int,
    max_elem: int,
    target: int,
) -> bool:
    """Exactly decide bounded factorisation, with ones filling unused cells.

    A greedy decomposition is only a positive witness. If it needs too many
    factors, the complete iterative search still runs; greedy failure must
    never reject a feasible cage (e.g. 216 = 6*6*6 with domain 1..8).
    """
    if cage_size < 0 or target <= 0:
        return False
    if target == 1:
        return True
    if cage_size == 0 or max_elem < 2 or target > max_elem ** cage_size:
        return False
    if target <= max_elem:
        return True

    factors = tuple(value for value in range(max_elem, 1, -1) if target % value == 0)
    remaining = target
    used = 0
    for value in factors:
        while remaining % value == 0:
            remaining //= value
            used += 1
    # Every allowable prime was included in factors. A non-unit residue has
    # an out-of-domain prime factor, so no bounded factorisation can exist.
    if remaining != 1:
        return False
    if used <= cage_size:
        return True

    # No recursion and no branches through factor 1: each edge strictly
    # reduces the product. More remaining slots dominates fewer for the same
    # residue, since surplus slots can always be filled with ones.
    work = [(target, cage_size)]
    seen: dict[int, int] = {}
    while work:
        remaining, slots = work.pop()
        if remaining == 1:
            return True
        if slots == 0 or remaining > max_elem ** slots:
            continue
        if remaining <= max_elem:
            return True
        if seen.get(remaining, -1) >= slots:
            continue
        seen[remaining] = slots
        for value in reversed(factors):
            if remaining % value == 0:
                work.append((remaining // value, slots - 1))
    return False
''' + text[b:]
p.write_text(text, encoding='utf-8')
replace(CAGE, '''                and any(
                    left == right * target or right == left * target
                    for left in range(1, max_elem + 1)
                    for right in range(1, max_elem + 1)
                )
''', '''                # (target, 1) witnesses every ratio in this range.
''')

TOPO = 'gridsolver/rules/topology.py'
method(TOPO, 'SingleLoopRule', '_potential_components', '')
method(TOPO, 'SingleLoopRule', '_bridge_edges', '')
p = Path(TOPO)
text = p.read_text(encoding='utf-8')
a = text.index('        # Iterative DFS (same overflow rationale as _bridge_edges).')
b = text.index('        for root in adjacency:', a)
text = text[:a] + '''        # Iterative DFS avoids one Python frame per graph vertex. Each
        # simple cycle lies in one cyclic vertex-biconnected block; bridges
        # and acyclic components never appear in the returned blocks.
''' + text[b:]
a = text.index('        root_by_cell, edges_by_root, vertices_by_root = (')
b = text.index('        blocks = self._cyclic_blocks(possible)', a)
text = text[:a] + '''        # This single analysis subsumes connected-component and bridge
        # pruning: every solution is a cycle in one block containing ALL
        # selected edges. Removing a bridge/other component cannot change a
        # cyclic block, so earlier passes do not add any eliminations.
''' + text[b:]
text = text.replace('        return components, component_by_vertex, edges_by_vertex\n\n\n\n\n', '        return components, component_by_vertex, edges_by_vertex\n\n')
p.write_text(text, encoding='utf-8')

p = Path('DEVELOPMENT.md')
text = p.read_text(encoding='utf-8')
text += '''

## Exact cage generation and graph simplification (September 2026)

Sum-plus-all-different cages use a staircase bijection rather than enumerating
repeated-value partitions and discarding them. For k strictly increasing
values x[i] in 1..M, y[i] = x[i] - i is nondecreasing in 1..M-k+1, with target
sum reduced by k*(k-1)/2. The inverse x[i] = y[i] + i is unique. Consequently
every admissible partition is preserved, in the same order. The existing exact
matching, guarantee restriction, and derived-cage pipeline is UNCHANGED and
still runs before branching. There is no approximate shortcut or deferred
fallback. The historical partition2() API continues to include repetitions.

Grid dimensions and domains are write-once even for mutable Grid instances;
solution identity and cached hashes cannot change through public assignments
or deletions. Clone and pickle layouts remain compatible.

KenKen product feasibility uses a greedy positive witness followed, when
needed, by complete iterative bounded-factor search. A failed greedy witness
never establishes impossibility. Factor 1 is represented as unused capacity,
not recursive work. Unsupported prime factors and product bounds are exact
rejections. This parser search is separate from puzzle-solver branching.

SingleLoopRule now uses only cyclic vertex-biconnected blocks for possible-edge
pruning. Every simple cycle lies in one such block. A viable block must contain
all selected edges; edges outside the union of viable blocks cannot be used.
This also rejects selected bridges and incompatible components without separate
bridge or connected-component passes. Selected-degree, premature-loop and final
completed-cycle checks remain in place. Linux and Windows share one CI matrix
with the existing check names and independent fail-fast-disabled execution.
'''
p.write_text(text, encoding='utf-8')
print('Applied exact-cage, immutable-metadata, product and loop changes.')
