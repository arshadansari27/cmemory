<!-- cmemory:tools-start -->
## cmemory — Persistent Project Memory

You have MCP tools that persist knowledge across sessions. Use them:

**search_lessons** — Call this FIRST when starting any task, debugging any bug, or touching unfamiliar code. Query with natural language: "auth token refresh", "stripe webhook handling", "database migration order". Past sessions may have already solved what you're about to work on.

**save_lesson** — Call after: fixing a non-obvious bug, discovering unexpected API behavior, finding a workaround, or learning why something is built a certain way. Good lessons: bug root causes, API gotchas, file-specific patterns. Bad lessons: basic setup steps, obvious errors. Write 1-3 sentences. Tag with file paths and concepts.

**reject_lesson** — Call this when search_lessons returns something wrong or outdated based on what you currently see in the code. Keeping stale lessons hurts future sessions.

**update_profile** — Call this when you learn something structural about the project: the stack, how auth works, how data is stored, deployment setup, target audience. Also call when these change: new integrations, auth migrations, database changes, deployment updates. The profile helps future sessions understand this project immediately.
<!-- cmemory:tools-end -->

<!-- cmemory:profile-start -->
## Project Profile (auto-managed by cmemory)

**cmemory** — A TypeScript CLI tool that gives Claude Code persistent memory across sessions via hooks, MCP tools, and vector search.

**Stack:** TypeScript + Node.js, compiled with `tsc`, tested with vitest. Uses `@huggingface/transformers` (nomic-ai/nomic-embed-text-v1.5, 768-dim) for local embeddings with asymmetric search prefixes (`search_query:` / `search_document:`). Distributed as a global npm package (on Windows, uses a `.cmd` shim in the npm global bin directory instead of symlinks).

**Architecture:** MCP server exposes four tools (search_lessons, save_lesson, reject_lesson, update_profile) as the primary interface. A single `UserPromptSubmit` hook outputs a nudge reminding Claude to use the MCP tools. Hooks registered in `~/.claude/settings.json`, MCP server registered via `claude mcp add`.

**Storage:** Per-project data lives in `.claude/cmemory/` (lessons.json, profile.json). Model cache is global at `~/.cmemory/models/`. CLAUDE.md has three auto-managed sections: tools, profile, lessons.

**CLI commands:** `init`, `install`, `add`, `status`, `lessons`, `forget`, `profile`, `sync`, `hook`, `mcp`.
<!-- cmemory:profile-end -->

<!-- cmemory:lessons-start -->
## Project Lessons (auto-managed by cmemory)
- On Windows 11, `npm link` creates symlinks/junctions that get blocked as "untrusted mount points." Instead of fighting symlinks, write a direct `.cmd` shim (`node "C:\absolute\path\dist\bin\cmemory.js" %*`) and a matching bash shim in the npm global bin directory.
- Claude Code MCP servers must be registered via `claude mcp add`, not by writing to `settings.json` or `~/.claude/settings.json`. The config lives in `~/.claude.json` under `projects.<path>.mcpServers`. Use `claude mcp remove` before `claude mcp add` to avoid duplicates.
<!-- cmemory:lessons-end -->
