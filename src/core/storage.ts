import * as fs from 'fs';
import * as path from 'path';
import { Lesson, Meta, PendingQueue, Profile } from './types';
import { cmemoryDir } from '../utils/paths';
import { debug, warn } from '../utils/logger';

// --- Atomic write helper ---

function atomicWriteSync(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      debug(`File not found: ${filePath}, using fallback`);
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    warn(`Failed to read ${filePath}: ${err}`);
    return fallback;
  }
}

// --- Profile ---

export function profilePath(projectRoot: string): string {
  return path.join(cmemoryDir(projectRoot), 'profile.json');
}

export function loadProfile(projectRoot: string): Profile {
  return readJsonSafe<Profile>(profilePath(projectRoot), {
    content: '',
    updatedAt: null,
  });
}

export function saveProfile(projectRoot: string, profile: Profile): void {
  atomicWriteSync(profilePath(projectRoot), JSON.stringify(profile, null, 2));
}

// --- Lessons ---

export function lessonsPath(projectRoot: string): string {
  return path.join(cmemoryDir(projectRoot), 'lessons.json');
}

export function loadLessons(projectRoot: string): Lesson[] {
  return readJsonSafe<Lesson[]>(lessonsPath(projectRoot), []);
}

export function saveLessons(projectRoot: string, lessons: Lesson[]): void {
  atomicWriteSync(lessonsPath(projectRoot), JSON.stringify(lessons, null, 2));
}

// --- Meta ---

export function metaPath(projectRoot: string): string {
  return path.join(cmemoryDir(projectRoot), 'meta.json');
}

export function loadMeta(projectRoot: string): Meta {
  return readJsonSafe<Meta>(metaPath(projectRoot), {
    version: 1,
    lastSyncAt: null,
  });
}

export function saveMeta(projectRoot: string, meta: Meta): void {
  atomicWriteSync(metaPath(projectRoot), JSON.stringify(meta, null, 2));
}

// --- Pending queue ---

export function pendingPath(projectRoot: string): string {
  return path.join(cmemoryDir(projectRoot), 'pending.json');
}

export function loadPending(projectRoot: string): PendingQueue {
  return readJsonSafe<PendingQueue>(pendingPath(projectRoot), { transcripts: [] });
}

export function appendPending(projectRoot: string, transcriptPath: string): void {
  const pending = loadPending(projectRoot);
  if (!pending.transcripts.includes(transcriptPath)) {
    pending.transcripts.push(transcriptPath);
  }
  atomicWriteSync(pendingPath(projectRoot), JSON.stringify(pending, null, 2));
}

export function clearPending(projectRoot: string): void {
  atomicWriteSync(pendingPath(projectRoot), JSON.stringify({ transcripts: [] }, null, 2));
}

// --- Init / check ---

export function isCmemoryInitialized(projectRoot: string): boolean {
  return fs.existsSync(cmemoryDir(projectRoot));
}

export function initCmemory(projectRoot: string): void {
  const dir = cmemoryDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(lessonsPath(projectRoot))) {
    atomicWriteSync(lessonsPath(projectRoot), JSON.stringify([], null, 2));
  }

  const meta: Meta = {
    version: 1,
    lastSyncAt: null,
  };
  if (!fs.existsSync(metaPath(projectRoot))) {
    atomicWriteSync(metaPath(projectRoot), JSON.stringify(meta, null, 2));
  }

  if (!fs.existsSync(pendingPath(projectRoot))) {
    atomicWriteSync(pendingPath(projectRoot), JSON.stringify({ transcripts: [] }, null, 2));
  }

  if (!fs.existsSync(profilePath(projectRoot))) {
    atomicWriteSync(profilePath(projectRoot), JSON.stringify({ content: '', updatedAt: null }, null, 2));
  }
}
