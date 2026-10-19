import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '..');
export const DATA_DIR = process.env.GITVIEWER_DATA || path.join(APP_ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  diffMode: 'split',
  pullMode: 'merge',
  confirmDestructive: true,
  fetchOnOpen: false,
  autoRefreshSeconds: 0,
  recentRepos: [],
  lastRepo: null,
  editorCommand: '',
  commitSignoff: false,
  graphCompact: false,
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings) {
  ensureDataDir();
  const clean = { ...DEFAULT_SETTINGS, ...settings };
  if (!Array.isArray(clean.recentRepos)) clean.recentRepos = [];
  clean.recentRepos = clean.recentRepos
    .filter((r) => r && typeof r.path === 'string')
    .slice(0, 30);
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_FILE);
  return clean;
}

export function saveSettings(patch) {
  const current = readSettings();
  return writeSettings({ ...current, ...patch });
}

export function touchRecent(repo) {
  const settings = readSettings();
  const list = settings.recentRepos.filter((r) => r.path.toLowerCase() !== repo.path.toLowerCase());
  list.unshift({ path: repo.path, name: repo.name, lastOpened: Date.now() });
  settings.recentRepos = list.slice(0, 30);
  settings.lastRepo = repo.path;
  writeSettings(settings);
  return settings;
}

export function removeRecent(repoPath) {
  const settings = readSettings();
  settings.recentRepos = settings.recentRepos.filter((r) => r.path !== repoPath);
  if (settings.lastRepo === repoPath) settings.lastRepo = null;
  return writeSettings(settings);
}

export function getRecent() {
  const settings = readSettings();
  return settings.recentRepos.map((r) => ({
    ...r,
    exists: fs.existsSync(r.path),
  }));
}
