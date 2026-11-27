# Typed-Array Myers

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/yorstann/typed-array-myers/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/yorstann/typed-array-myers/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0 (`diff-speed-01-run-20261126`, $100).

`solve.js` is a dependency-free ES module whose `run(input)` returns make.fun's
own patch of `{ old, new }` as one string — byte-identical to makefun-diff
1.0.0 on every case. `main.ts` reads every case from `/input/cases.json`,
answers each one alone with `run`, and writes `/output/answers.json`.

How it is faster: the edit script is Myers's greedy search with make.fun's
tie-break (the deletion when a deletion and an insertion reach the same
point, no edge-diagonal pruning), computed with typed V arrays and one
snapshot per edit depth, then walked back from the end to rebuild the exact
path — instead of the reference's linked path objects. Lines are compared by
small integer ids (one id per distinct line) instead of by string, and the
patch is built from run-length encoded ops.

On the practice set (4 cases, 21k–31k lines each) it answers exactly as the
oracle on every case, at about 4x the speed of the house baseline measured
side by side on one CPU.

Run it with:

```sh
MAKEFUN_INPUT_DIR=path/to/input MAKEFUN_OUTPUT_DIR=out node main.ts
```
