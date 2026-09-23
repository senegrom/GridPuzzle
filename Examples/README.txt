Example corpora for GridPuzzle.

Corpora for ten of the twelve families: Sudoku, Killer Sudoku, Futoshiki, KenKen, Latin squares (plain, diagonal and pandiagonal), Hidato, Kakuro, Numbrix and Slitherlink. Str8ts has no corpus here; its two newspaper photographs live under BrowserScanner/.

The Hidato, Kakuro, Numbrix and Slitherlink files are CSP-Rules forms and load through the normal file route (gridpuzzle --file Examples/Hidato/...); extended CI solves each of those corpora in isolated shards weekly and on every push to master that changes them, accepting the timeouts listed in benchmarks/corpus_timeout_baseline.json.

Each puzzle file holds the puzzle, the header it came with (reference, ASCII
rendering, difficulty rating) and nothing else. The CSP-Rules solving
transcripts these files were distributed with -- the derivation step by step,
its timing and the machine it ran on, none of which the loaders read -- were
removed; they remain in this repository's history.

Where applicable, source websites or authors are identified by the nested folder names and local README files.
