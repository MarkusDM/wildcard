import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let loaded = false;

function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separator = trimmed.indexOf('=');
  if (separator === -1) {
    return null;
  }

  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();

  if (!key) {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

function resolveEnvPath(): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, '.env'),
    path.resolve(cwd, 'server', '.env'),
    path.resolve(cwd, '..', '.env'),
    path.resolve(cwd, '..', 'server', '.env'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function ensureServerEnvLoaded(): void {
  if (loaded) {
    return;
  }

  const envPath = resolveEnvPath();
  if (!envPath) {
    loaded = true;
    return;
  }

  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const pair = parseLine(line);
    if (!pair) {
      continue;
    }

    const [key, value] = pair;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  loaded = true;
}
