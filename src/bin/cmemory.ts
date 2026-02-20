#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { initCmemory, isCmemoryInitialized, loadLessons, saveLessons, loadMeta, loadProfile, saveProfile } from '../core/storage';
import { getEmbedding, ensureModelDownloaded } from '../core/embeddings';
import { searchLessons } from '../core/search';
import { info, error as logError } from '../utils/logger';
import { findProjectRoot } from '../utils/paths';
import { updateClaudeMd } from '../synthesis/claude-md';

const program = new Command();

program
  .name('cmemory')
  .description('Lesson memory system for Claude Code CLI')
  .version('0.1.0');

// --- cmemory init ---
program
  .command('init')
  .description('Initialize cmemory in the current project')
  .action(async () => {
    const cwd = process.cwd();
    const alreadyInit = isCmemoryInitialized(cwd);
    initCmemory(cwd);
    if (alreadyInit) {
      console.log('cmemory is already initialized in this project (checked for missing files).');
      return;
    }
    console.log('Initialized cmemory in .claude/cmemory/');
    const { modelCacheDir } = await import('../utils/paths');
    if (fs.existsSync(modelCacheDir()) && fs.readdirSync(modelCacheDir()).length > 0) {
      console.log('\u2714 Embedding model already downloaded.');
    } else {
      console.log('Downloading embedding model (first time only)...');
      try {
        await ensureModelDownloaded();
        console.log('\u2714 Model downloaded successfully.');
      } catch (err) {
        console.error(`Warning: Model download failed: ${err}`);
        console.error('You can retry later — the model will be downloaded on first use.');
      }
    }
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    let hooksInstalled = false;
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        hooksInstalled = settings.hooks?.Stop?.some((h: any) =>
          h.hooks?.some((inner: any) => inner.command?.startsWith('cmemory hook'))
        ) ?? false;
      } catch {
        // ignore
      }
    }
    if (hooksInstalled) {
      console.log('\u2714 Hooks already installed.');
    } else {
      console.log('Run `cmemory install` to set up Claude Code hooks.');
    }
  });

// --- cmemory install ---
program
  .command('install')
  .description('Install cmemory hooks into Claude Code settings')
  .action(() => {
    const settingsDir = path.join(os.homedir(), '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    let settings: Record<string, any> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        console.error('Warning: Could not parse existing settings.json, creating new one.');
      }
    }

    if (!settings.hooks) {
      settings.hooks = {};
    }

    const cmemoryHooks: Record<string, any[]> = {
      UserPromptSubmit: [{
        matcher: '',
        hooks: [{ type: 'command', command: 'cmemory hook on-prompt', timeout: 5 }],
      }],
      PostToolUse: [{
        matcher: 'Read|Bash|Grep',
        hooks: [{ type: 'command', command: 'cmemory hook on-tool-use', timeout: 5 }],
      }],
      Stop: [{
        matcher: '',
        hooks: [{ type: 'command', command: 'cmemory hook on-stop', timeout: 10 }],
      }],
    };

    // Merge: preserve existing non-cmemory hooks, replace cmemory ones
    for (const [event, hookConfigs] of Object.entries(cmemoryHooks)) {
      const existing: any[] = settings.hooks[event] || [];
      // Remove old cmemory hooks
      const filtered = existing.filter((h: any) =>
        !h.hooks?.some((inner: any) => inner.command?.startsWith('cmemory hook'))
      );
      settings.hooks[event] = [...filtered, ...hookConfigs];
    }

    // Clean up legacy SessionEnd hook — synthesis now runs from Stop
    if (settings.hooks.SessionEnd) {
      settings.hooks.SessionEnd = (settings.hooks.SessionEnd as any[]).filter((h: any) =>
        !h.hooks?.some((inner: any) => inner.command?.startsWith('cmemory hook'))
      );
      if (settings.hooks.SessionEnd.length === 0) {
        delete settings.hooks.SessionEnd;
      }
    }

    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`Hooks installed in ${settingsPath}`);
    console.log('cmemory will now inject lessons during Claude Code sessions.');
  });

// --- cmemory add ---
program
  .command('add <text>')
  .description('Add a lesson manually')
  .option('--tags <tags>', 'Comma-separated tags', '')
  .action(async (text: string, opts: { tags: string }) => {
    const cwd = process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
      console.error('No cmemory project found. Run `cmemory init` first.');
      process.exit(1);
    }

    const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    const now = new Date().toISOString();

    console.log('Generating embedding...');
    const embedding = await getEmbedding(text);

    const lesson = {
      id: crypto.randomUUID(),
      content: text,
      tags,
      embedding,
      createdAt: now,
      updatedAt: now,
      source: 'manual' as const,
    };

    const lessons = loadLessons(projectRoot);
    lessons.push(lesson);
    saveLessons(projectRoot, lessons);
    updateClaudeMd(projectRoot);

    console.log(`Added lesson (${lesson.id})`);
    if (tags.length > 0) {
      console.log(`Tags: ${tags.join(', ')}`);
    }
  });

// --- cmemory status ---
program
  .command('status')
  .description('Show cmemory status for the current project')
  .action(() => {
    const cwd = process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
      console.log('cmemory is not initialized in this project.');
      console.log('Run `cmemory init` to get started.');
      return;
    }

    const lessons = loadLessons(projectRoot);
    const meta = loadMeta(projectRoot);
    const profile = loadProfile(projectRoot);

    console.log(`Project root: ${projectRoot}`);
    console.log(`Lessons: ${lessons.length}`);
    if (profile.content) {
      console.log(`Profile: ${profile.content.length} chars, last updated ${profile.updatedAt || 'unknown'}`);
    } else {
      console.log('Profile: (empty)');
    }
    console.log(`Last sync: ${meta.lastSyncAt || 'never'}`);

    // Check hook health
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    let hooksInstalled = false;
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        hooksInstalled = settings.hooks?.UserPromptSubmit?.some((h: any) =>
          h.hooks?.some((inner: any) => inner.command?.startsWith('cmemory hook'))
        ) ?? false;
      } catch {
        // ignore
      }
    }
    console.log(`Hooks: ${hooksInstalled ? 'installed' : 'not installed'}`);
  });

// --- cmemory lessons ---
program
  .command('lessons')
  .description('List all lessons or search semantically')
  .option('--search <query>', 'Semantic search query')
  .action(async (opts: { search?: string }) => {
    const cwd = process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
      console.error('No cmemory project found. Run `cmemory init` first.');
      process.exit(1);
    }

    const lessons = loadLessons(projectRoot);
    if (lessons.length === 0) {
      console.log('No lessons stored yet.');
      return;
    }

    if (opts.search) {
      console.log(`Searching for: "${opts.search}"\n`);
      const queryEmbedding = await getEmbedding(opts.search);
      const results = searchLessons(queryEmbedding, lessons, 0.0, 10);

      if (results.length === 0) {
        console.log('No matching lessons found.');
        return;
      }

      for (const r of results) {
        const tags = r.lesson.tags.length > 0 ? ` [${r.lesson.tags.join(', ')}]` : '';
        const score = (r.score * 100).toFixed(1);
        console.log(`  ${score}%  ${r.lesson.id.substring(0, 8)}  ${r.lesson.content}${tags}`);
      }
    } else {
      console.log(`${lessons.length} lesson(s):\n`);
      for (const l of lessons) {
        const tags = l.tags.length > 0 ? ` [${l.tags.join(', ')}]` : '';
        const date = new Date(l.updatedAt).toLocaleDateString();
        console.log(`  ${l.id.substring(0, 8)}  ${date}  ${l.content}${tags}`);
      }
    }
  });

// --- cmemory forget ---
program
  .command('forget <id>')
  .description('Remove a lesson by ID (prefix match supported)')
  .action((id: string) => {
    const cwd = process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
      console.error('No cmemory project found. Run `cmemory init` first.');
      process.exit(1);
    }

    const lessons = loadLessons(projectRoot);
    const matches = lessons.filter(l => l.id.startsWith(id));

    if (matches.length === 0) {
      console.error(`No lesson found matching ID: ${id}`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Ambiguous ID "${id}" matches ${matches.length} lessons. Be more specific.`);
      for (const m of matches) {
        console.error(`  ${m.id}  ${m.content.substring(0, 60)}`);
      }
      process.exit(1);
    }

    const toRemove = matches[0];
    const remaining = lessons.filter(l => l.id !== toRemove.id);
    saveLessons(projectRoot, remaining);
    updateClaudeMd(projectRoot);

    console.log(`Removed lesson: ${toRemove.content.substring(0, 80)}`);
  });

// --- cmemory profile ---
const profileCmd = program
  .command('profile')
  .description('View or manage the project profile')
  .action(() => {
    const cwd = process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
      console.error('No cmemory project found. Run `cmemory init` first.');
      process.exit(1);
    }

    const profile = loadProfile(projectRoot);
    if (!profile.content) {
      console.log('No profile yet.');
    } else {
      console.log(profile.content);
    }
  });

profileCmd
  .command('set')
  .description('Set the project profile (reads from stdin)')
  .action(() => {
    const cwd = process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
      console.error('No cmemory project found. Run `cmemory init` first.');
      process.exit(1);
    }

    const input = fs.readFileSync(0, 'utf-8').trim();
    if (!input) {
      console.error('No input provided. Pipe content via stdin, e.g.: echo "**Stack:** Node.js" | cmemory profile set');
      process.exit(1);
    }

    saveProfile(projectRoot, {
      content: input,
      updatedAt: new Date().toISOString(),
    });
    updateClaudeMd(projectRoot);
    console.log(`Profile set (${input.length} chars). CLAUDE.md updated.`);
  });

profileCmd
  .command('clear')
  .description('Clear the project profile')
  .action(() => {
    const cwd = process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
      console.error('No cmemory project found. Run `cmemory init` first.');
      process.exit(1);
    }

    saveProfile(projectRoot, {
      content: '',
      updatedAt: null,
    });
    updateClaudeMd(projectRoot);
    console.log('Profile cleared. CLAUDE.md updated.');
  });

// --- cmemory sync ---
program
  .command('sync')
  .description('Run lesson synthesis on pending transcripts')
  .option('--project-root <path>', 'Project root path (used by background process)')
  .action(async (opts: { projectRoot?: string }) => {
    const projectRoot = opts.projectRoot || findProjectRoot(process.cwd());
    if (!projectRoot) {
      console.error('No cmemory project found.');
      process.exit(1);
    }

    const { runSynthesis } = await import('../synthesis/synthesizer');
    const { processSynthesisResponse } = await import('../synthesis/processor');

    console.log('Running synthesis...');
    const response = runSynthesis(projectRoot);
    if (!response) {
      console.log('No synthesis results (no pending transcripts or synthesis failed).');
      return;
    }

    console.log(`Processing ${response.actions.length} action(s)...`);
    await processSynthesisResponse(projectRoot, response);
    console.log('Synthesis complete.');
  });

// --- cmemory hook <name> --- (hidden, used by Claude Code hooks)
const hookCmd = program
  .command('hook')
  .description('Run a hook handler (used internally by Claude Code)')
  .argument('<name>', 'Hook name: on-prompt, on-tool-use, on-stop, on-session-end');

hookCmd.action(async (name: string) => {
  switch (name) {
    case 'on-prompt': {
      const { onPrompt } = await import('../hooks/on-prompt');
      await onPrompt();
      break;
    }
    case 'on-tool-use': {
      const { onToolUse } = await import('../hooks/on-tool-use');
      await onToolUse();
      break;
    }
    case 'on-stop': {
      const { onStop } = await import('../hooks/on-stop');
      await onStop();
      break;
    }
    case 'on-session-end': {
      const { onSessionEnd } = await import('../hooks/on-session-end');
      await onSessionEnd();
      break;
    }
    default:
      logError(`Unknown hook: ${name}`);
      process.exit(0); // Never block Claude
  }
});

program.parseAsync().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
