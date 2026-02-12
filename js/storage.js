const STORAGE_KEY = "futaba-grapher-session-v1";
const SETTINGS_KEY = "futaba-grapher-settings-v1";

export function saveSession(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadSettingsStore() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSettingsStore(payload) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}
