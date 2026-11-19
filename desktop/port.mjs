import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The page origin includes the port. A fixed port keeps localStorage (answer
// drafts, selected goal, notices) under one origin across desktop restarts.
export const DEFAULT_PORTS = Array.from({ length: 10 }, (_, i) => 41731 + i);
const validPort = value => Number.isInteger(value) && value >= 1024 && value <= 65535;

export async function readSavedPort(file) {
  try {
    const port = JSON.parse(await readFile(file, 'utf8'))?.port;
    return validPort(port) ? port : null;
  } catch { return null; }
}

export async function savePort(file, port) {
  if (!validPort(port)) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ port }));
  await rename(`${file}.tmp`, file);
}

// Saved port first, then the default range; 0 (random) only as a last resort
// so the app still starts when every candidate is taken.
export function portCandidates(saved) {
  const preferred = validPort(saved) ? [saved] : [];
  return [...preferred, ...DEFAULT_PORTS.filter(port => port !== saved), 0];
}
