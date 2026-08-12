# Fish prologue and disjoint-union dedup — 2026-08-12

`fish`/`finned_fish` share `_fish_context` (the 10-line setup prologue) and
`_disjoint_union` (the guarantee-overlap check duplicated in both generic
enumerations), removing the last unlisted duplication in the module
(~40 lines).

Interleaved A/B against the 2e03062 baseline, identical solution keys in
every round. The machine drifted heavily (baseline blank 23.4-35.4s across
rounds); two runs disagreed in sign, so the change is noise-neutral:

| Case | Run 1 (fixed order, medians) | Run 2 (alternating order, medians) |
|---|---:|---:|
| blank 4x4 all-288 | -10.0% | -6.1% |
| non-square 6x6 cap-20 | +7.3% | -6.1% |

Decision: **promote** (pure dedup; no consistent cost signal in either
direction; run-order alternation eliminated the one apparent regression).
