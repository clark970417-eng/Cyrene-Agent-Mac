# Attribution and contribution accounting

This repository is a fork. Two people's work is interleaved in one history,
and commit counts describe that split badly — so this file records what the
git data actually says, and how to reproduce it.

Last recomputed: 2026-08-22, at commit `53c1a4ef`.

## Why commit counts mislead here

| Measure | Clark | Upstream lineage |
| --- | --- | --- |
| Commits | 61 of 1,295 — **4.7%** | 1,234 — 95.3% |
| Lines surviving in `src/` | 97,664 of 226,867 — **43.0%** | 129,231 — 57.0% |

The two rows differ by a factor of nine. The reason is commit granularity,
not effort: the upstream lineage committed in small increments over ten
weeks, while this fork's work landed in a smaller number of large,
subsystem-sized commits — several of them rescuing months of work that had
been sitting uncommitted in the working tree.

Blame share is the honest measure of who wrote the code that is running
today. Commit count measures how often someone typed `git commit`.

## The lineages

**Upstream** — `Playa-0v0 <ky2569ly@gmail.com>` (989 commits, 2026-07-08
onward) and `Cyrene Dev <cyrene@local>` (349 commits, 2026-06-11 to
2026-07-08) are the same lineage; the identity changed on the day the
project moved to GitHub. All 1,338 of those commits also exist on
`friend-readonly/master`. Smaller upstream contributions come from `lll69`,
`codex@local`, `agent@local`, and `Unknownuserfrommars`.

**This fork** — `Clark`, from 2026-07-27 onward. None of these commits exist
on `friend-readonly/master`.

## What this fork contributed

Relative to `friend-readonly/master`: **332 commits ahead**, 1,037 files
changed, +229,014 / −19,656 lines. (That total includes upstream commits
merged in by this fork; the blame figures above are the ones that isolate
authorship.)

By theme:

- **Upstream integration** — two large merges (2026-07-27, 2026-08-11)
  reconciling upstream with local features, repairing tests broken by
  incomplete upstream WIP, and restoring npm scripts and devDependencies
  that had been dropped from `package.json`.
- **macOS continuity** — stable application identity and `userData` path so
  memory, diaries, chats, channel links, and model settings survive
  upgrades; non-destructive startup migration; packaging and signing.
- **Unified workspace and theming** — chat, settings, and tasks in one
  window; synchronized dark/light themes; hardcoded colours routed through
  theme tokens.
- **Agent core** — the harness that owns a run end to end: scheduling,
  dispatch, streaming, compaction, retry and error classification, run
  recovery, bounded tool output, side-effect guards.
- **3D companion** — PMX/VMD scene on Three.js with Bullet physics, a
  procedural gesture system, arm IK, and song lip-sync.
- **Voice** — incremental local Whisper, Aliyun ASR, emotion-aware prosody,
  per-turn latency tracing, and the singing pipeline.
- **Developer subsystems** — LSP client, git service, MCP server, tracing.

## Reproducing these numbers

Blame share of the current source tree, ignoring whitespace and following
moved code:

```bash
git ls-files src | grep -E '\.(ts|tsx|css)$' \
  | xargs -P 8 -I{} git blame --line-porcelain -w -M -- {} 2>/dev/null \
  | grep '^author ' | sed 's/^author //' | sort | uniq -c | sort -rn
```

Commit counts by author:

```bash
git shortlog -sne HEAD
```

Divergence from upstream:

```bash
git rev-list --count friend-readonly/master..HEAD
git diff --shortstat friend-readonly/master...HEAD
```

## Caveats

- Blame credits the last person to touch a line. A refactor that reformats
  someone else's logic transfers credit; `-w -M` reduces but does not
  eliminate this.
- Generated files (`package-lock.json`, `dist/`) and binary assets are
  excluded from the blame scope, which covers `src/**` only.
- Line counts are not a measure of value. They are here because commit
  counts were being read as one, and they are less wrong.
