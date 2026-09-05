from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"Expected exactly one patch anchor in {path}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Blank markers belong to the cage layout, never to arithmetic targets.
for path in ("gridsolver/grid_classes/kenken.py", "gridsolver/grid_classes/killer_sudoku.py"):
    replace_once(path,
        "        dictionary_text = _load_preprocess_str(dictionary_text)",
        "        # Do not rewrite '.' inside arithmetic targets as a blank zero.\n"
        "        dictionary_text = ''.join(dictionary_text.split())")

replace_once("gridsolver/abstract_grids/grid_loading.py", '''    if isinstance(values, str):
        normalized: str | list[str] = (
            _load_preprocess_str_space_sep(values)
            if space_sep
            else _load_preprocess_str(values)
        )
''', '''    if isinstance(values, str):
        normalized: str | list[str]
        if _puzzle_class_key(class_) in {"kenken", "killersudoku"}:
            # Infer dimensions from the normalized layout, but preserve the
            # target dictionary for the cage parser's strict integer grammar.
            # Normalizing the entire string would silently turn 0.6 into 006.
            layout, separator, dictionary = values.partition(":")
            if space_sep:
                normalized = _load_preprocess_str_space_sep(layout)
                if separator:
                    normalized.extend((separator, dictionary))
            else:
                normalized = _load_preprocess_str(layout) + separator + dictionary
        else:
            normalized = (
                _load_preprocess_str_space_sep(values)
                if space_sep
                else _load_preprocess_str(values)
            )
''')

replace_once("gridsolver/abstract_grids/grid.py", '''        def build_branch_peers() -> tuple[frozenset[int], ...]:
            peers = [set() for _ in range(self.len)]
''', '''        def build_branch_peers() -> tuple[frozenset[int], ...] | None:
            # A whole-grid rule already makes every cell a peer of every
            # other cell. Represent that clique implicitly rather than storing
            # O(cells**2) entries (e.g. Slitherlink's global loop constraint).
            # None is cached with the usual rule-only invalidation lifecycle.
            if any(rule.len_cells == self.len for rule in self.rules):
                return None
            peers = [set() for _ in range(self.len)]
''')
replace_once("gridsolver/abstract_grids/grid.py", '''        best: tuple[tuple[int, int, int], int, set[int]] | None = None
        for cell, possible in enumerate(self._candidates):
''', '''        if branch_peers is None:
            # Sum intersections via value frequencies. Only unknown peers
            # contribute; subtract this cell's own contribution below. These
            # counts are candidate-dependent, so never cache them as structure.
            value_counts = [0] * (self.max_elem + 1)
            for peer, possible in enumerate(self._candidates):
                if self._known[peer] == 0:
                    for value in possible:
                        value_counts[value] += 1

        best: tuple[tuple[int, int, int], int, set[int]] | None = None
        for cell, possible in enumerate(self._candidates):
''')
replace_once("gridsolver/abstract_grids/grid.py", '''            pressure = sum(
                len(possible & self._candidates[peer])
                for peer in branch_peers[cell]
                if self._known[peer] == 0
            )
''', '''            if branch_peers is None:
                pressure = sum(value_counts[value] for value in possible)
                if self._known[cell] == 0:
                    pressure -= len(possible)
            else:
                pressure = sum(
                    len(possible & self._candidates[peer])
                    for peer in branch_peers[cell]
                    if self._known[peer] == 0
                )
''')

# Keep every successfully submitted future reachable even if the next submit
# fails. Terminate inside the context before __exit__ can wait on siblings.
parallel = Path("gridsolver/solver/solve_parallel.py")
text = parallel.read_text(encoding="utf-8")
start = text.index("        # Keep no more than one outstanding branch per worker.")
end = text.index("\n    return _cap_solutions(solutions, max_sols)", start)
text = text[:start] + '''        futures = deque()
        try:
            # Keep no more than one outstanding branch per worker. Append
            # incrementally so a later submission failure retains earlier work
            # for cancellation, rather than losing a half-built deque.
            initial_count = min(processes, len(ordered_branches))
            for cell, value in ordered_branches[:initial_count]:
                futures.append(pool.submit(worker, (cell, value, max_sols)))
            next_branch_index = initial_count

            while futures:
                future = futures.popleft()
                result = future.result()
                if stats is None:
                    branch_solutions = result
                else:
                    branch_solutions, branch_stats = result
                    stats.merge(branch_stats)
                solutions.update(branch_solutions)

                if 0 < max_sols <= len(solutions):
                    for pending in futures:
                        pending.cancel()
                    if futures:
                        pool.terminate_workers()
                    break

                if next_branch_index < len(ordered_branches):
                    cell, value = ordered_branches[next_branch_index]
                    next_branch_index += 1
                    futures.append(
                        pool.submit(worker, (cell, value, max_sols))
                    )
        except BaseException as error:
            # Includes KeyboardInterrupt/SystemExit, errors while submitting,
            # worker exceptions, and errors while combining results/stats.
            # A plain context-manager exit waits for already-running siblings.
            for pending in futures:
                try:
                    pending.cancel()
                except Exception as cleanup_error:
                    error.add_note(f"Future cancellation failed: {cleanup_error!r}")
            try:
                pool.terminate_workers()
            except Exception as cleanup_error:
                # Cleanup must not replace the useful original branch error.
                error.add_note(f"Worker termination failed: {cleanup_error!r}")
            raise
''' + text[end:]
parallel.write_text(text, encoding="utf-8")

replace_once(".github/workflows/ci.yml", '''      - name: Validate package and console script
        run: |
          python -m pip wheel --no-deps . --wheel-dir dist
          gridpuzzle --help
''', '''      - name: Validate the wheel outside the source checkout
        run: |
          python -m pip wheel --no-deps . --wheel-dir dist
          python scripts/smoke_wheel.py --wheel-dir dist
''')
replace_once(".github/workflows/ci.yml", '''      - name: Smoke installed console script
        run: gridpuzzle --help
''', '''      - name: Validate the wheel outside the source checkout
        run: |
          python -m pip wheel --no-deps . --wheel-dir dist
          python scripts/smoke_wheel.py --wheel-dir dist
''')
replace_once("DEVELOPMENT.md", "- builds a wheel and checks the installed console command;", "- builds a wheel, installs it into a fresh virtual environment outside the\n  checkout, and checks imports, the console command, a small solve, and a\n  bundled example with PYTHONPATH/PYTHONHOME removed;")
