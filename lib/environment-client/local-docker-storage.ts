import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";

// Plain localStorage CRUD for registered local Docker environments — no React
// here, kept separate from hooks/use-local-docker-environments.ts so it's
// trivially testable and reusable outside a component. First use of
// localStorage in this app; scoped only to this feature, since there is
// nowhere else this data could live (this app has no server-side persistence
// and a local Docker instance has no Marketplace resourceAccess registration).

const STORAGE_KEY = "sitecoreai-content-transfer:local-docker-environments:v1";

function readAll(): LocalDockerEnvironmentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: LocalDockerEnvironmentEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function list(): LocalDockerEnvironmentEntry[] {
  return readAll();
}

export function add(
  entry: Omit<LocalDockerEnvironmentEntry, "kind" | "id">,
): LocalDockerEnvironmentEntry {
  const full: LocalDockerEnvironmentEntry = {
    ...entry,
    kind: "local-docker",
    id: crypto.randomUUID(),
  };
  writeAll([...readAll(), full]);
  return full;
}

export function update(
  id: string,
  patch: Partial<Omit<LocalDockerEnvironmentEntry, "kind" | "id">>,
): void {
  writeAll(
    readAll().map((e) => (e.id === id ? { ...e, ...patch } : e)),
  );
}

export function remove(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id));
}

export { STORAGE_KEY };
