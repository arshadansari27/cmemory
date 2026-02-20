import * as fs from 'fs';
import * as path from 'path';
import { loadLessons, loadProfile } from '../core/storage';
import { Lesson, Profile } from '../core/types';
import { debug } from '../utils/logger';

const LESSON_MARKER_START = '<!-- cmemory:lessons-start -->';
const LESSON_MARKER_END = '<!-- cmemory:lessons-end -->';
const LESSON_HEADER = '## Project Lessons (auto-managed by cmemory)';

const PROFILE_MARKER_START = '<!-- cmemory:profile-start -->';
const PROFILE_MARKER_END = '<!-- cmemory:profile-end -->';
const PROFILE_HEADER = '## Project Profile (auto-managed by cmemory)';

/**
 * Build the managed lesson section content.
 */
function buildLessonSection(lessons: Lesson[]): string {
  // Sort by updatedAt descending, take top 10
  const top = [...lessons]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  if (top.length === 0) {
    return `${LESSON_MARKER_START}\n${LESSON_MARKER_END}`;
  }

  const lines = top.map(l => `- ${l.content}`);
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
 * Replace or insert a managed section in CLAUDE.md content by its markers.
 */
function upsertSection(content: string, markerStart: string, markerEnd: string, section: string): string {
  const startIdx = content.indexOf(markerStart);
  const endIdx = content.indexOf(markerEnd);

  if (startIdx !== -1 && endIdx !== -1) {
    return content.substring(0, startIdx) + section + content.substring(endIdx + markerEnd.length);
  }

  // Not found — append at current insertion point (caller decides order)
  return null as any; // Signal: not found
}

/**
 * Update the managed sections in CLAUDE.md.
 * Creates the file if missing. Preserves all content outside the markers.
 * Profile section appears above lessons section.
 */
export function updateClaudeMd(projectRoot: string): void {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  const lessons = loadLessons(projectRoot);
  const profile = loadProfile(projectRoot);
  const lessonSection = buildLessonSection(lessons);
  const profileSection = buildProfileSection(profile);

  let content: string;

  if (fs.existsSync(claudeMdPath)) {
    content = fs.readFileSync(claudeMdPath, 'utf-8');

    // Update profile section
    const profileStart = content.indexOf(PROFILE_MARKER_START);
    const profileEnd = content.indexOf(PROFILE_MARKER_END);
    if (profileStart !== -1 && profileEnd !== -1) {
      content = content.substring(0, profileStart) + profileSection + content.substring(profileEnd + PROFILE_MARKER_END.length);
    }

    // Update lesson section
    const lessonStart = content.indexOf(LESSON_MARKER_START);
    const lessonEnd = content.indexOf(LESSON_MARKER_END);
    if (lessonStart !== -1 && lessonEnd !== -1) {
      content = content.substring(0, lessonStart) + lessonSection + content.substring(lessonEnd + LESSON_MARKER_END.length);
    }

    // If neither section exists yet, insert both at top (profile above lessons)
    const hasProfile = content.indexOf(PROFILE_MARKER_START) !== -1;
    const hasLessons = content.indexOf(LESSON_MARKER_START) !== -1;

    if (!hasProfile && !hasLessons) {
      content = profileSection + '\n\n' + lessonSection + '\n\n' + content;
    } else if (!hasProfile) {
      // Insert profile before lessons
      const lessonPos = content.indexOf(LESSON_MARKER_START);
      content = content.substring(0, lessonPos) + profileSection + '\n\n' + content.substring(lessonPos);
    } else if (!hasLessons) {
      // Insert lessons after profile
      const profileEndPos = content.indexOf(PROFILE_MARKER_END) + PROFILE_MARKER_END.length;
      content = content.substring(0, profileEndPos) + '\n\n' + lessonSection + content.substring(profileEndPos);
    }
  } else {
    content = profileSection + '\n\n' + lessonSection + '\n';
  }

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
  debug(`Updated CLAUDE.md with profile and ${lessons.length} lesson(s)`);
}
