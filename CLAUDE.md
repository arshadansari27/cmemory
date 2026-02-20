<!-- cmemory:profile-start -->
## Project Profile (auto-managed by cmemory)

**cmemory** — A TypeScript CLI tool that gives Claude Code persistent memory across sessions via hooks and vector search.

**Stack:** TypeScript + Node.js, compiled with `tsc`, tested with vitest. Uses `@xenova/transformers` (Xenova/bge-small-en-v1.5, 384-dim) for local embeddings. Distributed as a global npm package (`npm link`).

**Architecture:** Four Claude Code hooks intercept the session lifecycle — `UserPromptSubmit` searches lessons and injects them via stdout, `PostToolUse` (Read/Bash/Grep) injects tool-relevant lessons, `Stop` queues transcripts with >5 tool calls to `pending.json`, `SessionEnd` spawns `cmemory sync` in the background. A synthesis pipeline runs `claude -p --model sonnet` to extract lessons from queued transcripts and writes them to `lessons.json`.

**Storage:** Per-project data lives in `.claude/cmemory/` (lessons.json, meta.json, pending.json). Model cache is global at `~/.cmemory/models/`. Hooks are registered in `~/.claude/settings.json`.

**CLI commands:** `init`, `install`, `add`, `status`, `lessons`, `forget`, `sync`, `hook`. 26 tests passing across storage, paths, search, and processor modules.
<!-- cmemory:profile-end -->

<!-- cmemory:lessons-start -->
## Project Lessons (auto-managed by cmemory)
- Write path-related tests with `path.join` or platform-neutral assertions rather than hardcoded forward slashes. Windows path tests fail when the code returns backslash-separated paths.
- When reading stdin with a timeout, rejecting the promise doesn't stop the stream. Use a `settled` boolean flag to prevent double-resolve, and call `process.stdin.destroy()` in the timeout branch to clean up the resource.
- Allowing spaces in a file-path regex is too greedy — it captures trailing words after the path. For heuristic path extraction, allow hyphens and both slash directions but not spaces.
- To count occurrences of a type in JSONL transcripts, parse each line as JSON and check `entry.type === 'tool_use'`. Regex-matching the string `"tool_use"` on raw text inflates the count if any tool output contains that literal string.
- Don't store derived counts (e.g. `lessonCount`) in persistent metadata when they can be computed from the source of truth (`lessons.length`). Stored counts drift when multiple code paths update the array without syncing the counter.
- On Windows, `spawn('cmemory', ...)` fails because npm creates a `.cmd` wrapper that bare `spawn` can't find. Always pass `shell: true` when spawning npm-linked CLI tools on Windows.
- Claude Code hooks must output plain text to stdout — not a JSON wrapper like `{ hookSpecificOutput: ... }`. Returning JSON breaks the hook injection mechanism. Only the raw text content should be written to stdout.
<!-- cmemory:lessons-end -->
