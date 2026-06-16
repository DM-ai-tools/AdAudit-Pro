import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { User } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../.data');
const USERS_FILE = join(DATA_DIR, 'users.json');

interface PersistedUsers {
  users: User[];
  savedAt: string;
}

export function loadPersistedUsers(): User[] {
  try {
    if (!existsSync(USERS_FILE)) return [];
    const raw = readFileSync(USERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedUsers;
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch (err) {
    console.warn('Could not load persisted users:', err);
    return [];
  }
}

export function persistUsers(users: Iterable<User>): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const payload: PersistedUsers = {
      users: [...users],
      savedAt: new Date().toISOString(),
    };
    writeFileSync(USERS_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not persist users:', err);
  }
}
