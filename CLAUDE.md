<!-- cmemory:tools-start -->
## cmemory Tools (auto-managed by cmemory)

You have these MCP tools for persistent project memory:

- **search_lessons** — Search past lessons by semantic similarity. Use at the start of tasks.
- **save_lesson** — Save a new lesson. Auto-checks for duplicates; use replace_id to update or force: true to skip.
- **reject_lesson** — Remove a wrong or stale lesson by ID (prefix match supported).
- **update_profile** — Replace the project profile (stack, architecture, conventions).

**Workflow:** Search before you work. Save when you learn.
<!-- cmemory:tools-end -->

<!-- cmemory:profile-start -->
## Project Profile (auto-managed by cmemory)

**cmemory** — A TypeScript CLI tool that gives Claude Code persistent memory across sessions via hooks, MCP tools, and vector search.

**Stack:** TypeScript + Node.js, compiled with `tsc`, tested with vitest. Uses `@huggingface/transformers` (nomic-ai/nomic-embed-text-v1.5, 768-dim) for local embeddings with asymmetric search prefixes (`search_query:` / `search_document:`). Distributed as a global npm package (`npm link`).

**Architecture:** MCP server exposes four tools (search_lessons, save_lesson, reject_lesson, update_profile) as the primary interface. A single `UserPromptSubmit` hook outputs a nudge reminding Claude to use the MCP tools. Hooks registered in `~/.claude/settings.json`, MCP server registered via `claude mcp add`.

**Storage:** Per-project data lives in `.claude/cmemory/` (lessons.json, profile.json). Model cache is global at `~/.cmemory/models/`. CLAUDE.md has three auto-managed sections: tools, profile, lessons.

**CLI commands:** `init`, `install`, `add`, `status`, `lessons`, `forget`, `profile`, `sync`, `hook`, `mcp`.
<!-- cmemory:profile-end -->

<!-- cmemory:lessons-start -->
## Project Lessons (auto-managed by cmemory)
- On Windows 11, `npm link` creates symlinks/junctions that get blocked as "untrusted mount points." Instead of fighting symlinks, write a direct `.cmd` shim (`node "C:\absolute\path\dist\bin\cmemory.js" %*`) and a matching bash shim in the npm global bin directory.
- Claude Code MCP servers must be registered via `claude mcp add`, not by writing to `settings.json` or `~/.claude/settings.json`. The config lives in `~/.claude.json` under `projects.<path>.mcpServers`. Use `claude mcp remove` before `claude mcp add` to avoid duplicates.
<!-- cmemory:lessons-end -->
