import * as fs from 'fs';
import * as path from 'path';
import { loadLessons, loadProfile } from '../core/storage';
import { Lesson, Profile } from '../core/types';
import { debug } from '../utils/logger';

const TOOLS_MARKER_START = '<!-- cmemory:tools-start -->';
const TOOLS_MARKER_END = '<!-- cmemory:tools-end -->';
const TOOLS_HEADER = '## cmemory — Persistent Project Memory';

const PROFILE_MARKER_START = '<!-- cmemory:profile-start -->';
const PROFILE_MARKER_END = '<!-- cmemory:profile-end -->';
const PROFILE_HEADER = '## Project Profile (auto-managed by cmemory)';

const LESSON_MARKER_START = '<!-- cmemory:lessons-start -->';
const LESSON_MARKER_END = '<!-- cmemory:lessons-end -->';
const LESSON_HEADER = '## Project Lessons (auto-managed by cmemory)';

/**
 * Build the managed tools section content.
 */
function buildToolsSection(): string {
  const body = [
    '',
    'You have MCP tools that persist knowledge across sessions. Use them:',
    '',
    '**search_lessons** — Call this FIRST when starting any task, debugging any bug, or touching unfamiliar code. Query with natural language: "auth token refresh", "stripe webhook handling", "database migration order". Past sessions may have already solved what you\'re about to work on.',
    '',
    '**save_lesson** — Call after: fixing a non-obvious bug, discovering unexpected API behavior, finding a workaround, or learning why something is built a certain way. Good lessons: bug root causes, API gotchas, file-specific patterns. Bad lessons: basic setup steps, obvious errors. Write 1-3 sentences. Tag with file paths and concepts.',
    '',
    '**reject_lesson** — Call this when search_lessons returns something wrong or outdated based on what you currently see in the code. Keeping stale lessons hurts future sessions.',
    '',
    '**update_profile** — Call this when you learn something structural about the project: the stack, how auth works, how data is stored, deployment setup, target audience. Also call when these change: new integrations, auth migrations, database changes, deployment updates. The profile helps future sessions understand this project immediately.',
  ];
  return [TOOLS_MARKER_START, TOOLS_HEADER, ...body, TOOLS_MARKER_END].join('\n');
}

/**
 * Build the managed lesson section content.
 */
// Keep the always-in-context lesson section small: full lesson text is
// retrievable on demand via search_lessons.
export const CLAUDE_MD_LESSON_COUNT = 5;
export const CLAUDE_MD_LESSON_CHARS = 300;

function buildLessonSection(lessons: Lesson[]): string {
  // Sort by updatedAt descending, take the most recent few
  const top = [...lessons]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, CLAUDE_MD_LESSON_COUNT);

  if (top.length === 0) {
    return `${LESSON_MARKER_START}\n${LESSON_MARKER_END}`;
  }

  const lines = top.map(l => {
    const text = l.content.length > CLAUDE_MD_LESSON_CHARS
      ? `${l.content.slice(0, CLAUDE_MD_LESSON_CHARS)}… (truncated — search_lessons for full text)`
      : l.content;
    return `- ${text}`;
  });
  return [LESSON_MARKER_START, LESSON_HEADER, ...lines, LESSON_MARKER_END].join('\n');
}

/**
 * Build the managed profile section content.
 */
export function buildProfileSection(profile: Profile): string {
  if (!profile.content) {
    return `${PROFILE_MARKER_START}\n${PROFILE_MARKER_END}`;
  }

  return [PROFILE_MARKER_START, PROFILE_HEADER, '', profile.content, PROFILE_MARKER_END].join('\n');
}

/**
 * Upsert a managed section in CLAUDE.md content by its markers.
 * Returns the updated content, or null if the markers were not found.
 */
function upsertSection(content: string, markerStart: string, markerEnd: string, section: string): string | null {
  const startIdx = content.indexOf(markerStart);
  const endIdx = content.indexOf(markerEnd);

  if (startIdx !== -1 && endIdx !== -1) {
    return content.substring(0, startIdx) + section + content.substring(endIdx + markerEnd.length);
  }

  return null; // Not found
}

/**
 * Update the managed sections in CLAUDE.md.
 * Creates the file if missing. Preserves all content outside the markers.
 * Section order: tools (top) → profile → lessons.
 */
export function updateClaudeMd(projectRoot: string): void {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  const lessons = loadLessons(projectRoot);
  const profile = loadProfile(projectRoot);
  const toolsSection = buildToolsSection();
  const profileSection = buildProfileSection(profile);
  const lessonSection = buildLessonSection(lessons);

  let content: string;

  if (fs.existsSync(claudeMdPath)) {
    content = fs.readFileSync(claudeMdPath, 'utf-8');

    // Update each section if its markers exist
    const sections = [
      { start: TOOLS_MARKER_START, end: TOOLS_MARKER_END, section: toolsSection },
      { start: PROFILE_MARKER_START, end: PROFILE_MARKER_END, section: profileSection },
      { start: LESSON_MARKER_START, end: LESSON_MARKER_END, section: lessonSection },
    ];

    for (const { start, end, section } of sections) {
      const updated = upsertSection(content, start, end, section);
      if (updated !== null) {
        content = updated;
      }
    }

    // Insert any missing sections in order: tools → profile → lessons
    const hasTools = content.indexOf(TOOLS_MARKER_START) !== -1;
    const hasProfile = content.indexOf(PROFILE_MARKER_START) !== -1;
    const hasLessons = content.indexOf(LESSON_MARKER_START) !== -1;

    if (!hasTools && !hasProfile && !hasLessons) {
      // None exist — prepend all three
      content = toolsSection + '\n\n' + profileSection + '\n\n' + lessonSection + '\n\n' + content;
    } else if (!hasTools) {
      // Insert tools before whichever comes first (profile or lessons)
      const profilePos = content.indexOf(PROFILE_MARKER_START);
      const lessonPos = content.indexOf(LESSON_MARKER_START);
      const insertPos = profilePos !== -1 ? profilePos : lessonPos;
      content = content.substring(0, insertPos) + toolsSection + '\n\n' + content.substring(insertPos);
    }

    // Re-check after tools insertion
    const hasProfileNow = content.indexOf(PROFILE_MARKER_START) !== -1;
    const hasLessonsNow = content.indexOf(LESSON_MARKER_START) !== -1;

    if (!hasProfileNow && !hasLessonsNow) {
      // Insert both after tools
      const toolsEndPos = content.indexOf(TOOLS_MARKER_END) + TOOLS_MARKER_END.length;
      content = content.substring(0, toolsEndPos) + '\n\n' + profileSection + '\n\n' + lessonSection + content.substring(toolsEndPos);
    } else if (!hasProfileNow) {
      // Insert profile between tools and lessons
      const lessonPos = content.indexOf(LESSON_MARKER_START);
      content = content.substring(0, lessonPos) + profileSection + '\n\n' + content.substring(lessonPos);
    } else if (!hasLessonsNow) {
      // Insert lessons after profile
      const profileEndPos = content.indexOf(PROFILE_MARKER_END) + PROFILE_MARKER_END.length;
      content = content.substring(0, profileEndPos) + '\n\n' + lessonSection + content.substring(profileEndPos);
    }
  } else {
    content = toolsSection + '\n\n' + profileSection + '\n\n' + lessonSection + '\n';
  }

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
  debug(`Updated CLAUDE.md with tools, profile, and ${lessons.length} lesson(s)`);
}
