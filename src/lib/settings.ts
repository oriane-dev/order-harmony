// Ledger's own local settings (Anthropic API key for AI-assisted PDF extraction).
// Origin-scoped localStorage — independent of Thalae's own `so3_cfg`, even though
// both apps may store an equivalent key.

const STORAGE_KEY = "ledger_cfg";

export interface LedgerSettings {
  apiKey?: string;
}

export function getSettings(): LedgerSettings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveSettings(next: LedgerSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
