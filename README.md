# cmemory

Persistent memory for Claude Code. Lessons learned in one session carry over to the next.

cmemory is deliberately simple. No databases, no cloud services, no RAG pipelines. Just JSON files, a small embedding model, and two integration points into Claude Code. That simplicity is the entire point — it works because there's almost nothing to break.

## Quick Start

```bash
npm install -g cmemory

# One-time: register hooks + MCP server with Claude Code
cmemory install

# Per-project: initialize memory storage
cd your-project
cmemory init
```

That's it. Start a Claude Code session and cmemory is working.

## How It Works

cmemory has three jobs: get Claude to use the tools, store what it learns, and surface it when relevant. Here's every piece.

### The Nudge (UserPromptSubmit Hook)

The single most important design decision. Claude Code supports hooks — shell commands that run on specific events. cmemory registers one hook on `UserPromptSubmit` that fires every time you send a message.

The hook prints a short reminder to stdout:

```
You have cmemory tools available. Use search_lessons to find relevant context for this task.

# cmemory — Persistent Project Memory (12 lessons stored)

**search_lessons**({ query }) — Call this FIRST when starting any task...
**save_lesson**({ content, tags }) — Call after: fixing a non-obvious bug...
**reject_lesson**({ lesson_id }) — Call this when search_lessons returns something wrong...
**update_profile**({ content }) — Call this when you learn something structural...
```

Why nudge on every prompt? Because LLMs forget. MCP tools exist in the tool list, but Claude won't reliably use them unless reminded. The nudge keeps the tools fresh in Claude's working memory. Without it, Claude uses the tools for the first few messages then stops. With it, Claude searches for lessons at the start of tasks and saves them when it learns something.

The nudge and the CLAUDE.md tool instructions are kept 1:1 — same wording, same guidance. CLAUDE.md provides the instructions when the session starts, the nudge reinforces them on every turn.

### The MCP Server (4 Tools)

The MCP server is the actual interface Claude uses. It exposes four tools over stdio:

- **search_lessons** — Takes a natural language query, embeds it, runs cosine similarity against all stored lessons, returns the top matches.
- **save_lesson** — Stores a new lesson with its embedding. Auto-checks for duplicates before saving (cosine similarity > 0.50 flags it). Supports `replace_id` to update in place, or `force` to skip the check.
- **reject_lesson** — Deletes a lesson by ID (prefix match supported). Used when Claude finds a stored lesson is wrong or outdated.
- **update_profile** — Replaces the project profile (stack, architecture, conventions). Gives future sessions instant context about the project.

The MCP server is registered globally via `claude mcp add`, which means it's available in every project. But data is per-project — the server resolves the project root by walking up from `cwd` looking for `.claude/cmemory/`. If you haven't run `cmemory init` in a project, the tools return "not initialized" errors. This is how cross-project support works: one MCP server, per-project storage.

### The Embedding Model

cmemory uses `nomic-ai/nomic-embed-text-v1.5` via `@huggingface/transformers`, running locally in Node.js with ONNX. No API calls, no tokens, no network needed after the initial download.

The model produces 768-dimensional vectors. It uses asymmetric search prefixes — queries are prefixed with `search_query:` and documents with `search_document:` — which is how nomic was trained and gives better retrieval than symmetric search.

The model is downloaded once on `cmemory init` and cached globally at `~/.cmemory/models/`. After that, it loads from disk with remote model checks disabled.

### Memory Footprint

Claude Code starts one cmemory MCP server **per session**, so the model's footprint is paid once per open session, not once per machine. Two things keep that affordable:

- The model loads with `dtype: 'q8'` (~140MB of weights instead of 522MB for fp32). Measured on one embedding call: **390MB RSS instead of 1109MB**. Retrieval separation is unaffected — the worst matching pair scores 0.4982 against a best non-match of 0.4533.
- The pipeline is released after 5 minutes with no embedding call, and reloaded on demand (a few seconds). Override with `CMEMORY_MODEL_IDLE_MS`; `0` disables it.

The release only returns memory to the OS if glibc is told to trim, which it does not do by default at these allocation sizes. If you run several concurrent sessions, launch the MCP server with:

```json
{ "env": { "MALLOC_TRIM_THRESHOLD_": "131072", "MALLOC_ARENA_MAX": "2" } }
```

With those set, an idle server falls to **120MB**; without them it settles around 260MB.

### The Adaptive Threshold

The similarity threshold scales with the number of stored lessons:

| Lessons | Threshold |
|---------|-----------|
| < 5     | 0.55      |
| 5–14    | 0.52      |
| 15+     | 0.50      |

Empirical testing with nomic-embed-text-v1.5 shows relevant queries score 0.63+ while irrelevant ones score 0.54 and below. The thresholds sit just below this natural gap — permissive enough to catch real matches, strict enough to filter noise.

### The LRU Cap

Lessons don't grow forever. There's a hard cap of 100 lessons per project. When you exceed it, the oldest lessons (by `updatedAt`) get evicted — least recently updated, out. This keeps storage bounded and quality high. Old lessons you never update are presumably the least valuable.

The cap is enforced on every save operation. The eviction is simple: sort by `updatedAt` descending, keep the first 100.

### Deduplication

When saving a new lesson, cmemory embeds it and compares against all existing lessons. If anything scores above 0.50 similarity, it refuses the save and tells Claude about the duplicate — including the existing lesson's ID so Claude can use `replace_id` to update it instead, or `force` to save it anyway.

This prevents the lesson store from filling up with 15 variations of the same insight.

### The CLAUDE.md Updater

Every time a lesson is saved, rejected, or the profile is updated, cmemory rewrites three managed sections in your project's `CLAUDE.md`:

1. **Tools section** — Instructions for how to use the MCP tools (matches the nudge 1:1)
2. **Profile section** — The project profile (stack, architecture, conventions)
3. **Lessons section** — The 10 most recent lessons as bullet points

Each section is wrapped in HTML comment markers (`<!-- cmemory:tools-start -->` / `<!-- cmemory:tools-end -->`). cmemory only touches content between its markers — everything else in CLAUDE.md is preserved.

This means when Claude starts a new session and reads CLAUDE.md, it immediately sees the project profile and recent lessons before it even uses any tools.

### Storage

All data lives in two JSON files per project:

```
your-project/
  .claude/
    cmemory/
      lessons.json    # Array of lessons with embeddings
      profile.json    # Project profile text
```

A lesson looks like:

```json
{
  "id": "uuid",
  "content": "The auth middleware silently swallows 401s when...",
  "tags": ["auth", "middleware"],
  "embedding": [0.012, -0.034, ...],  // 768 floats
  "createdAt": "2025-01-15T...",
  "updatedAt": "2025-01-15T...",
  "source": "manual"
}
```

No database. No migrations. JSON files you can read, edit, or delete with any tool.

## CLI Commands

| Command | Description |
|---------|-------------|
| `cmemory install` | One-time setup: registers hook + MCP server with Claude Code |
| `cmemory init` | Initialize cmemory in the current project |
| `cmemory status` | Show lesson count, profile status, hook health |
| `cmemory lessons` | List all lessons |
| `cmemory lessons --search "query"` | Semantic search across lessons |
| `cmemory add "lesson text"` | Add a lesson from the command line |
| `cmemory forget <id>` | Remove a lesson by ID (prefix match) |
| `cmemory profile` | View the current project profile |
| `cmemory profile set` | Set profile from stdin |
| `cmemory profile clear` | Clear the project profile |
| `cmemory sync` | Re-sync CLAUDE.md with current data |

## Why It Works

cmemory is ~400 lines of actual logic spread across 8 files. There is no scheduler, no background process, no queue, no cache invalidation, no config file format, no plugin system.

The design is:

1. **Nudge on every prompt** so Claude actually uses the tools
2. **Four MCP tools** so Claude can read and write lessons
3. **Cosine similarity search** so retrieval is semantic, not keyword-based
4. **Adaptive thresholds** so results are good from the start
5. **LRU eviction** so storage stays bounded
6. **Dedup on save** so the store doesn't fill with noise
7. **CLAUDE.md sync** so new sessions start with context

Each piece is obvious. None of them are clever. That's the point.
