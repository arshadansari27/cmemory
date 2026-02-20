# cmemory — Architecture & Planning Prompt

## The Core Idea

cmemory is a **lesson memory system for Claude Code CLI**. It synthesizes lessons from coding sessions, stores them as embeddings, and **automatically surfaces relevant lessons** through two channels: top lessons baked into `CLAUDE.md` (read on every session start), and contextual lessons injected mid-session via hooks.

The key insight: **Claude will never voluntarily call a "lessons" MCP tool.** It doesn't know what it doesn't know. So instead of asking Claude to search for lessons, we surface them automatically — the most important ones via `CLAUDE.md`, and contextually relevant ones via hook injection.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code CLI                           │
│                                                                  │
│  Session Start → reads CLAUDE.md (top 10 lessons)          │
│                                                                  │
│  User: "login is broken"                                         │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────┐        │
│  │  UserPromptSubmit   │    │  PostToolUse (Read/Bash)  │        │
│  │  Hook (exit 0)      │    │  Hook (additionalContext) │        │
│  │  ↓ stdout = context │    │  ↓ JSON = context         │        │
│  └────────┬────────────┘    └────────────┬─────────────┘        │
│           │                              │                       │
└───────────┼──────────────────────────────┼───────────────────────┘
            │                              │
            ▼                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                     cmemory Hook Scripts                          │
│                                                                   │
│  1. Embed full prompt / tool context as single semantic query       │
│  2. Local embeddings (transformers.js, bge-small-en-v1.5)          │
│  3. Brute-force cosine similarity against lesson embeddings        │
│  4. Return top lessons above threshold as context                  │
│                                                                   │
│  Persistent: Top 10 lessons written to CLAUDE.md             │
│  Storage: JSON files in .claude/cmemory/ (project-scoped)          │
│  Synthesis: Queue on Stop → single `claude -p` on SessionEnd       │
└───────────────────────────────────────────────────────────────────┘
```

---

## Three Injection Mechanisms

### 1. `UserPromptSubmit` — Inject on user prompt

**How it works:** When the user submits a prompt, this hook fires. Your script receives the prompt text via stdin JSON. You query the vector store, and anything you print to stdout (exit code 0) gets injected as context that Claude sees.

**What to query:** The full user prompt as a single embedding. Do NOT decompose into file names, function names, or keywords. Vector embeddings capture semantic meaning — "login is broken" naturally matches lessons about auth failures, token refresh bugs, and session handling without needing to extract "auth.ts" as a keyword. Decomposing creates false positives: querying "auth.ts" alone would match every lesson mentioning that file regardless of relevance.

```typescript
// ❌ BAD — decomposing creates false matches
const queries = [
  userPrompt,                    // "login is broken"
  ...extractFileNames(prompt),   // "auth.ts" — matches everything about auth.ts
  ...extractFunctions(prompt),   // "refreshToken" — same problem
];

// ✅ GOOD — single semantic query, let embeddings do the work
const queryEmbedding = await getEmbedding(userPrompt);
const results = searchLessons(queryEmbedding, lessons, 0.70, 5);
```

**Output format:**
```
⚡ Relevant lessons from past sessions:
• [auth.ts] Token refresh silently fails when session cookie is expired — must check cookie expiry BEFORE calling refreshToken()
• [login page] The React hydration mismatch on /login was caused by server-side date formatting — use suppressHydrationWarning on the timestamp span
Use these if applicable. Ignore if not relevant.
```

### 2. `PostToolUse` — Inject during Claude's reasoning

**How it works:** After Claude reads a file, runs a bash command, or greps — `PostToolUse` fires. You get the tool name, input, AND output. Return JSON with `additionalContext` field and Claude sees it.

**What to query:** Build a natural language description of what Claude is doing, NOT just the file path. Embed the full tool context — file path + what's being explored + any command context. This produces a much more targeted semantic query than the user's original prompt.

```typescript
// ❌ BAD — bare file path matches every lesson about that file
const query = toolInput.file_path; // "src/middleware/auth.ts"

// ✅ GOOD — natural language captures the semantic intent
// For Read: combine file path with any surrounding context
const query = `reading ${toolInput.file_path} for debugging`;
// For Bash: the command itself is rich context
const query = `running command: ${toolInput.command}`;
// For Grep: the search pattern tells you what Claude is looking for
const query = `searching for ${toolInput.pattern} in ${toolInput.path || 'codebase'}`;
```

**Output format (JSON on stdout, exit 0):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "⚡ Lesson: auth.ts — The refreshToken() call on line 47 silently swallows 401 errors. Previous fix was to add explicit status check before retry loop."
  }
}
```

**Which tools to fire on:** `Read`, `Bash`, `Grep` — these are the exploration tools. Skip `Write`, `Edit`, `Glob`, `LS` (low signal).

### 3. `CLAUDE.md` — Top lessons always visible

Instead of a SessionStart hook, cmemory writes top lessons directly into `CLAUDE.md`. Claude already reads this file on every session start — zero new infrastructure.

cmemory uses comment markers to own a section without touching the user's content. Lessons are project knowledge — they belong in version control so the whole team benefits. The markers make the section easy to resolve if merge conflicts occur.

cmemory uses comment markers to own a section without touching anything else:

```markdown
<!-- cmemory:lessons-start -->
## Project Lessons (auto-managed by cmemory)

- The Stripe webhook handler in api/webhooks.ts silently drops events when signature verification throws. Catch the error explicitly and return 400.
- Database migrations must run before seed scripts. The seed references tables that don't exist yet if you reverse the order.
- The auth token refresh in lib/auth.ts has a race condition when two requests fire simultaneously. Use the mutex pattern in lib/locks.ts.

<!-- cmemory:lessons-end -->
```

**How it gets updated:** After synthesis completes (`on-session-end.js`), cmemory rewrites the section with the current top 10 lessons sorted by recency. The markers let it find and replace its own block without touching anything the user has written above or below.

**This eliminates the SessionStart hook entirely.** No model loading on startup, no embedding queries, no blocking. Lessons are just text in a file Claude already reads.

---

## Lesson Storage — Project-Scoped in `.claude/`

**Lessons live in each project's `.claude` folder.** This means lessons are automatically scoped to the project, travel with the repo (or can be gitignored), and require zero global configuration.

```
my-project/
├── .claude/
│   ├── settings.json          # Claude Code project settings (already exists)
│   ├── settings.local.json    # Local overrides (already exists)
│   └── cmemory/
│       ├── lessons.json       # All lessons + embeddings for THIS project
│       └── meta.json          # Project name, last sync, stats
├── CLAUDE.md                  # Project instructions + cmemory's managed lesson section
├── src/
└── ...
```

**Why `.claude/` and not `~/.cmemory/`:**
- Lessons are inherently project-specific — a lesson about auth.ts in project A is noise in project B
- `.claude/` already exists in Claude Code projects, so no new top-level dotfolder
- Teams can choose to commit `cmemory/lessons.json` to share lessons, or gitignore it for personal use
- No global registry to maintain — cmemory just checks if `.claude/cmemory/` exists in the cwd

### Cross-Project Lesson Queries

Sometimes a prompt references another project. The user might type a path like `~/projects/other-app/src/auth.ts` or say "same bug we had in the billing service." Rather than requiring Claude to call an MCP tool, **the hook scripts detect external file paths and automatically query those projects' lessons too.**

**How it works in `on-prompt.js`:**

1. Scan the user prompt for absolute file paths or `~/` paths
2. For each detected path, resolve it to a project root (walk up to find `.claude/cmemory/`)
3. Query the **current project's lessons** with the full raw prompt
4. Query **each referenced project's lessons** with the prompt minus the file path (so the semantic query is about the *concept*, not the path)
5. Combine results, deduplicate by lesson ID, inject all

```typescript
// Example: user types "the login bug from ~/projects/billing-app/src/auth.ts is happening here too"
const currentProjectResults = searchLessons(
  await getEmbedding(fullPrompt),          // Full prompt against current project
  currentLessons, 0.70, 5
);

const otherProjectResults = searchLessons(
  await getEmbedding(promptWithoutPaths),  // "the login bug is happening here too"
  billingAppLessons, 0.70, 3              // Query billing-app's lessons
);

// Combine and inject both, labeled by project
```

**Output format when cross-project lessons are found:**
```
⚡ Relevant lessons from this project:
• [auth.ts] Token refresh silently fails when session cookie is expired

⚡ Relevant lessons from billing-app:
• [auth.ts] The 401 retry loop in billing-app had the same silent failure — fix was adding explicit status check before refreshToken() call

Use these if applicable. Ignore if not relevant.
```

This is fully automatic — no MCP tool, no Claude decision-making, no global lesson pool to maintain.

### Lesson Schema

```typescript
interface Lesson {
  id: string;                    // uuid
  content: string;               // The lesson text (1-3 sentences)
  tags: string[];                // File paths, function names, concepts
  embedding: number[];           // 384-dim float array (bge-small-en-v1.5)
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp — set when Sonnet updates/re-confirms
  source: {
    sessionId: string;           // Claude Code session ID
    conversationExcerpt: string; // Brief context of discovery
  };
}
```

**Why no confidence score or hit count?** Lessons don't score themselves — Sonnet curates them. Every lesson in the store is treated as equally valid because it was either freshly synthesized or explicitly kept alive by Sonnet during dedup. Stale lessons get replaced or removed during synthesis, not decayed by a timer. See "Lesson Synthesis — Sonnet as Curator" below.

### Vector Search — Brute Force

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function searchLessons(queryEmbedding: number[], lessons: Lesson[], threshold = 0.70, topK = 5): Lesson[] {
  return lessons
    .map(l => ({ lesson: l, score: cosineSimilarity(queryEmbedding, l.embedding) }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => r.lesson);
}
```

At 1000 lessons with 384-dim vectors, this runs in **< 5ms**. No index needed.

### Query Strategy — Why Single Queries, Not Decomposition

**Core principle: Embed the full semantic context as one query. Never decompose into keywords or file names.**

Vector embeddings capture *meaning*, not keywords. When you embed "login is broken", the resulting 384-dimensional vector sits near other vectors about authentication failures, session expiry, token refresh bugs — even if they share zero words. That's the whole point of semantic search.

Decomposing a prompt into file names and function names creates problems:
- **False positives:** Querying "auth.ts" alone matches every lesson mentioning that file, regardless of whether it's about login, logout, permissions, or something unrelated
- **Noise:** Returning 5 marginally-related lessons drowns out the 1 actually-relevant one
- **Wasted context:** Injecting irrelevant lessons burns context window space that Claude could use for actual work

**The threshold does the filtering work.** A similarity threshold of 0.70+ ensures only semantically relevant lessons surface. If "login is broken" doesn't match any lesson above 0.70, that's the correct behavior — it means you don't have a relevant lesson yet.



---

## Embeddings — Zero Native Builds

Use `@huggingface/transformers` (transformers.js). It runs via ONNX Runtime compiled to WASM. No native compilation, no GPU, works on Windows/Mac/Linux identically.

```typescript
import { pipeline } from '@huggingface/transformers';

// Cache the extractor — model loads once, ~30MB download on first run
let extractor: any = null;

async function getEmbedding(text: string): Promise<number[]> {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
  }
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}
```

**Model choice:** `bge-small-en-v1.5` — 384 dimensions, ~30MB, handles up to 256 tokens well. Perfect for lesson-length text (1-3 sentences).



---

## Lesson Synthesis — Sonnet as Curator

### No API Key Required

Synthesis uses `claude -p` (print/headless mode) which inherits the user's existing CLI authentication — whether that's a Claude Pro/Max subscription, OAuth, or an API key. No additional configuration needed. Token usage counts toward their normal plan.

### Queue + Process Model

**The `Stop` hook does NOT run synthesis.** Claude stops constantly — after answering questions, finishing small tasks, pausing for input. Spawning a Sonnet process on every stop would pile up background processes, create race conditions on `lessons.json`, and waste tokens on trivial sessions.

Instead:

1. **`Stop` hook** — Appends `transcript_path` to `.claude/cmemory/pending.json`. Three lines of code, instant, exit 0.
2. **`SessionEnd` hook** — Fires once when the session is truly over. Spawns ONE background process that works through the pending queue.
3. **`cmemory sync`** — Manual trigger, same process, for when you want to force synthesis.

```
.claude/cmemory/
├── lessons.json       # All lessons + embeddings
├── meta.json          # Project metadata
└── pending.json       # Queue of transcript paths awaiting synthesis
```

### The Single-Pass Synthesis Call

We collapse extraction + curation into ONE `claude -p` call. Sonnet gets both the transcript AND the existing lessons simultaneously, so it can make better decisions about what's new vs what's a duplicate vs what contradicts existing knowledge. One CLI boot, one call, done.

**Critical: No tool access.** This call must be pure text-in, JSON-out. Sonnet reads the transcript (already piped in as text) and the existing lessons (also text). It does NOT explore the codebase, read files, run commands, or spawn subagents. The transcript already contains everything it needs — the files Claude read, the errors it hit, the fixes it applied. Granting tools would waste tokens, slow synthesis, and risk unintended side effects.

We enforce this with:
- `--max-turns 1` — One response, no agentic loop
- No `--allowedTools` flag — In `-p` mode, tools require explicit permission. No permission = no tools.
- System prompt explicitly says "Respond ONLY with JSON. Do not use any tools."

```bash
cat <<EOF | claude -p \
  --model sonnet \
  --max-turns 1 \
  --output-format json \
  --system-prompt "You are a lessons database curator for a software project. Respond ONLY with JSON. Do not use any tools."
  
You have two inputs:

1. A Claude Code session transcript from a development session
2. The current set of existing lessons stored for this project

Your job:
- Extract any new, specific, actionable lessons from the transcript
- Compare each candidate against existing lessons
- For each candidate, decide: "new", "duplicate", "update", or "contradiction"

RULES:
- A "lesson" is a specific, actionable insight (1-3 sentences) that would help future development on this codebase
- DO extract: bugs and root causes, non-obvious API behavior, file-specific gotchas, config issues, component dependencies
- DO NOT extract: generic advice ("always handle errors"), obvious facts ("React uses JSX"), or one-off fixes that won't recur
- "duplicate" = an existing lesson already says the same thing, even if worded differently → discard candidate
- "update" = candidate has newer/corrected info about the same topic → replace existing with candidate
- "contradiction" = existing lesson is now stale/wrong based on this session → replace existing with candidate
- "new" = no existing lesson covers this topic → add candidate

EXISTING LESSONS:
${existingLessonsJson}

SESSION TRANSCRIPT:
${transcriptContent}

Respond with ONLY this JSON structure:
{
  "actions": [
    {
      "action": "add",
      "lesson": { "content": "...", "tags": ["file.ts", "concept"] }
    },
    {
      "action": "replace",
      "targetId": "existing-lesson-uuid",
      "lesson": { "content": "updated lesson text", "tags": ["..."] },
      "reason": "Auth was migrated from JWT to session cookies"
    },
    {
      "action": "discard",
      "reason": "Duplicate of existing lesson abc123"
    }
  ]
}
EOF
```

### What This Guarantees

- **No duplicates** — Sonnet catches rephrased versions of existing lessons
- **No contradictions** — Stale lessons get replaced, not accumulated alongside correct ones
- **No scoring needed** — Every lesson in the store is valid. If it wasn't, Sonnet would have replaced or discarded it. No confidence scores, no decay, no hit counting.
- **No API key** — Uses `claude -p` with existing CLI auth, counts toward normal plan usage
- **No process pileup** — Queue model means one synthesis process per session, triggered at `SessionEnd`
- **Cost** — One Sonnet call per session (only sessions above complexity threshold), background/async

### Synthesis Threshold

Not every session is worth synthesizing. A user asking "what does this function do?" doesn't produce lessons. Only queue transcripts for synthesis if the session meets a minimum complexity:

```typescript
// In the Stop hook, before queuing:
const input = JSON.parse(readStdin());
const transcript = fs.readFileSync(input.transcript_path, 'utf8');
const toolCalls = (transcript.match(/"tool_use"/g) || []).length;

// Only queue if the session had meaningful work
if (toolCalls < 5) process.exit(0);

// Queue for synthesis
appendToPending(input.transcript_path);
```

### Transcript Size Management

Long sessions produce large transcripts that may exceed Sonnet's context window. For transcripts over a certain size:

1. Truncate to the most recent N tool calls (the end of a session is usually where the resolution/fix lives)
2. Or split into chunks and synthesize each chunk separately (still one `claude -p` call per chunk)
3. Include existing lessons in full every time — they're small (just text + tags, no embeddings)

---

## Hook Configuration

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.cmemory/hooks/on-prompt.js",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Read|Bash|Grep",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.cmemory/hooks/on-tool-use.js",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.cmemory/hooks/on-stop.js",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.cmemory/hooks/on-session-end.js",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

---

## Hook Scripts (What each does)

### `on-prompt.js`
1. Read stdin JSON → extract `prompt` field
2. Embed the full prompt as a single semantic query (do NOT decompose into keywords/filenames)
3. Query current project's `.claude/cmemory/lessons.json` with cosine similarity threshold ≥ 0.70
4. Scan prompt for external file paths → if found, resolve to other project roots, query their lessons with prompt-minus-paths
5. Combine results, deduplicate, print matching lessons to stdout (plain text, exit 0)
6. If no lessons above threshold, print nothing (exit 0)

### `on-tool-use.js`
1. Read stdin JSON → extract `tool_name`, `tool_input`, `tool_response`
2. Build a natural language query from tool context (NOT bare file paths — see Query Strategy above)
3. Embed and query with cosine similarity threshold ≥ 0.70
4. Print JSON with `hookSpecificOutput.additionalContext` to stdout (exit 0)
5. If no lessons above threshold, print empty JSON (exit 0)

### `on-stop.js`
1. Read `transcript_path` from stdin JSON
2. Check if `.claude/cmemory/` exists for this project — if not, exit silently
3. Read transcript, count tool calls — if < 5, exit (not worth synthesizing)
4. Append `transcript_path` to `.claude/cmemory/pending.json` queue
5. Exit immediately (exit 0) — no synthesis here, just queuing

### `on-session-end.js`
1. Check if `.claude/cmemory/pending.json` has any queued transcripts
2. If empty, exit silently
3. Spawn a detached background process that:
   - Reads all queued transcript paths
   - Loads existing lessons (content + tags only, no embeddings — keeps the prompt small)
   - Runs ONE `claude -p --model sonnet --max-turns 1` call — no `--allowedTools`, so Sonnet has zero tool access. Pure text-in, JSON-out.
   - Parses the JSON response: apply `add`, `replace`, `discard` actions
   - Embeds any new/updated lessons locally via transformers.js
   - Writes updated `lessons.json`
   - **Rewrites the `<!-- cmemory:lessons-start -->` section in `CLAUDE.md`** with the current top 10 lessons (sorted by recency). Creates the file if it doesn't exist.
   - Clears `pending.json`
4. Exit immediately (the background process runs after the session is gone)

---

## Performance Considerations

| Operation | Expected Time | Notes |
|-----------|--------------|-------|
| Model load (first call) | 2-3s | Cache in long-running process |
| Embed one query | 10-50ms | After model loaded |
| Search 1000 lessons | < 5ms | Brute-force cosine similarity |
| Total hook latency | < 100ms | After warmup |

**Critical:** The `UserPromptSubmit` and `PostToolUse` hooks BLOCK Claude until they complete. Keep timeout at 5 seconds max.

---

## CLI Commands

```bash
cmemory init                    # Initialize cmemory for current project (creates .claude/cmemory/)
cmemory lessons                 # List all lessons for current project
cmemory lessons --search "auth" # Search lessons semantically
cmemory add "lesson text"       # Manually add a lesson
cmemory forget <id>             # Remove a lesson
cmemory sync                    # Force re-synthesis from recent transcripts
cmemory install                 # Configure hooks in Claude Code settings
cmemory status                  # Show stats, hook health, lesson count
```

---

## Tech Stack Summary

| Component | Choice | Why |
|-----------|--------|-----|
| Language | TypeScript/Node.js | Same ecosystem as Claude Code, CodeGraph |
| Embeddings | `@huggingface/transformers` | Pure WASM, no native builds, runs everywhere |
| Model | `Xenova/bge-small-en-v1.5` | 384-dim, ~30MB, fast, good for short text |
| Storage | JSON files in `.claude/cmemory/` | Project-scoped, no DB needed at lesson scale, zero deps |
| Synthesis LLM | Sonnet via `claude -p` | Uses existing CLI auth, no API key needed, counts toward plan |
| Hooks | Claude Code native hooks | `UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionEnd` |
| Persistent lessons | `CLAUDE.md` | Top 10 lessons, zero runtime cost, Claude reads it natively |
| Package | npm (global install) | Same distribution as CodeGraph |

---

## What Makes This Different from the original CMEM

1. **No MCP tool dependency** — Claude never needs to decide to call a tool
2. **CLAUDE.md** — Top lessons written directly into the file Claude already reads on every session, zero runtime cost
3. **Contextual injection** — Hook-based mid-session injection surfaces lessons relevant to what Claude is actively doing
4. **Official hook API** — Uses `additionalContext` and stdout injection, not hacks
5. **Zero native builds** — WASM embeddings, JSON storage, works on Windows
6. **Project-scoped** — Lessons live in `.claude/cmemory/`, travel with the project, no global config
7. **Cross-project aware** — Detects external file paths in prompts and auto-queries other projects' lessons
8. **Sonnet-curated** — Single-pass synthesis handles dedup, contradictions, and stale lessons automatically
9. **No API key** — Uses `claude -p` with existing CLI auth, no extra configuration
10. **Queue model** — Stop hooks queue cheaply, SessionEnd processes once, no process pileup

---

## Open Questions for Discussion

1. **Synthesis threshold** — How many tool calls before a session is worth synthesizing? Too low wastes `claude -p` calls; too high misses quick but valuable debugging sessions. Current proposal: 5 tool calls minimum.
2. **Max context injection** — How many lessons per injection before it becomes noise? Current proposal: 3-5 max per project.
3. **`.claude/cmemory/` in gitignore** — The lessons themselves are shared via `CLAUDE.md` (committed). The `.claude/cmemory/` directory contains raw storage with embeddings — should `cmemory init` gitignore it by default? Probably yes, since `CLAUDE.md` is the sharing mechanism now.
4. **Transcript truncation** — Long sessions may exceed Sonnet's context window. Truncate from the beginning (keep the resolution), or chunk and synthesize each chunk?
