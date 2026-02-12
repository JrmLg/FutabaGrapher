const TIME_HINTS = ["time", "temps", "ms", "millisecond", "seconds", "sec", "timestamp"];

const UNIT_HINTS = [
  { regex: /\b(v|volt(age)?)\b/i, unit: "V", type: "voltage" },
  { regex: /\b(a|amp(ere)?|current)\b/i, unit: "A", type: "current" },
  { regex: /\bmah|capacity\b/i, unit: "mAh", type: "capacity" },
  { regex: /\btemp|celsius|°c\b/i, unit: "degC", type: "temperature" },
  { regex: /\bstatus\b/i, unit: "", type: "status" },
  { regex: /\bch\d+\b/i, unit: "%", type: "servo" },
  { regex: /\btime|ms|sec\b/i, unit: "ms", type: "time" }
];

export function normalizeName(input) {
  return String(input || "").trim().replace(/\s+/g, " ");
}

export function extractUnitFromHeader(header) {
  const text = normalizeName(header);
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    return parenMatch[1].trim();
  }
  const bracketMatch = text.match(/\[([^\]]+)\]/);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1].trim();
  }
  for (const hint of UNIT_HINTS) {
    if (hint.regex.test(text)) {
      return hint.unit;
    }
  }
  return "";
}

export function inferColumnType(name, numericRatio) {
  const lowered = normalizeName(name).toLowerCase();
  for (const hint of UNIT_HINTS) {
    if (hint.regex.test(lowered)) {
      return hint.type;
    }
  }
  if (numericRatio > 0.85) return "numeric";
  return "text";
}

export function detectTimeColumn(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return -1;
  for (let i = 0; i < columns.length; i += 1) {
    const n = normalizeName(columns[i]).toLowerCase();
    if (n === "time") return i;
  }
  for (let i = 0; i < columns.length; i += 1) {
    const n = normalizeName(columns[i]).toLowerCase();
    if (TIME_HINTS.some((hint) => n === hint || n.includes(hint))) return i;
  }
  for (let i = 0; i < columns.length; i += 1) {
    if (/^ch\d+$/i.test(normalizeName(columns[i]))) return Math.max(0, i - 1);
  }
  return 0;
}

export function detectHeaderRow(rawRows) {
  for (let i = 0; i < Math.min(rawRows.length, 20); i += 1) {
    const row = rawRows[i] || [];
    const filled = row.filter((cell) => normalizeName(cell) !== "");
    if (filled.length < 3) continue;
    const hasTime = filled.some((cell) => /^time$/i.test(normalizeName(cell)));
    const hasChannels = filled.some((cell) => /^ch\d+$/i.test(normalizeName(cell)));
    if (hasTime || hasChannels) return i;
  }
  for (let i = 0; i < Math.min(rawRows.length, 12); i += 1) {
    const row = rawRows[i] || [];
    const filled = row.filter((cell) => normalizeName(cell) !== "");
    if (filled.length < 3) continue;
    const isLikelyHeader = filled.some((cell) => /[a-zA-Z]/.test(cell));
    if (isLikelyHeader) return i;
  }
  return 0;
}
