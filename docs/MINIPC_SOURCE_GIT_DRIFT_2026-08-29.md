# MiniPC source Git drift — 2026-08-29

Observed after a successful Production deployment:

- deployed release marker: `be5f84bf9f2571a1f190f4e6646457edefb70523`
- MiniPC `/home/tnfwod/projects/wholesalehub/.git` HEAD: `25cfd4e260aec32e0e8daf1dd11a04232f6acdbd`

This is not a Production storefront failure. The deploy wrapper currently overlays the normalized GitHub release files into the MiniPC project at `[R6]` and writes `reports/runtime/deployed-github-head.txt`, but it does not advance the existing `.git` metadata. Therefore the filesystem can contain the deployed release while Git still reports an older HEAD.

This matters for Telegram AI coding control because `scripts/ai-worker.sh` uses `/home/tnfwod/projects/wholesalehub` as a Git worktree and captures before/after `git status` and `git diff`. A stale `.git` HEAD can make a clean deployed source tree look like a large unrelated modification set and can mislead Codex/OpenCode.

## Required repair rule

Do not solve this with an unconditional `git reset --hard`, `git clean`, or checkout that could erase MiniPC-local work.

The runtime repair must first collect:

- current branch and HEAD;
- tracked/staged/untracked status counts;
- whether local commits exist that are not in GitHub main;
- whether the current working-tree bytes match the deployed GitHub release;
- whether runtime-only files are correctly ignored/untracked.

If and only if no local source work would be lost, align the canonical AI coding worktree with GitHub `main` using the least destructive Git operation available. Otherwise preserve the local work on a backup branch/commit or move AI coding to a clean dedicated checkout and update the Telegram worker to use that canonical checkout.

Preferred long-term architecture: Production deployment artifacts and the AI coding Git worktree must not silently diverge. One of these designs must be chosen and documented:

1. a clean dedicated Git checkout for Telegram/Codex/OpenCode development, with Production deployed from verified commits; or
2. a source mirror whose Git metadata is advanced only after a verified safe-state check.

Do not treat `reports/runtime/deployed-github-head.txt` as a substitute for a coherent Git worktree when an AI worker is expected to modify/commit code.
