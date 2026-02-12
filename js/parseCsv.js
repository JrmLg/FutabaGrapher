import { detectHeaderRow, detectTimeColumn, extractUnitFromHeader, inferColumnType, normalizeName } from "./detectors.js";

const EXPECTED_HEADERS = [
  "TIME",
  "CH1",
  "CH2",
  "CH3",
  "CH4",
  "CH5",
  "CH6",
  "CH7",
  "CH8",
  "CH9",
  "CH10",
  "CH11",
  "CH12",
  "CH13",
  "CH14",
  "CH15",
  "CH16",
  "BATTERY",
  "EXTERNAL BATTERY",
  "STATUS",
  "CURRENT",
  "VOLTAGE",
  "CAPACITY"
];

function validateExpectedHeaders(headers) {
  if (!Array.isArray(headers) || headers.length < EXPECTED_HEADERS.length) return false;
  for (let i = 0; i < EXPECTED_HEADERS.length; i += 1) {
    const got = normalizeName(headers[i]).toLowerCase();
    const expected = EXPECTED_HEADERS[i].toLowerCase();
    if (got !== expected) return false;
  }
  return true;
}

function toDefaultDisplayName(rawName, fallbackIndex) {
  const clean = normalizeName(rawName);
  if (!clean) return `Column ${fallbackIndex + 1}`;
  return clean
    .split(" ")
    .map((word) => {
      if (/^ch\d+$/i.test(word)) return word.toUpperCase();
      if (/^[A-Z0-9]+$/.test(word) && word.length <= 4) return word;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 20);
  const score = (delimiter) => {
    const counts = lines.map((line) => line.split(delimiter).length);
    const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
    const variance = counts.reduce((acc, value) => acc + (value - avg) ** 2, 0) / Math.max(1, counts.length);
    return { avg, variance };
  };
  const sc = score(";");
  const cc = score(",");
  if (sc.avg <= 1 && cc.avg <= 1) return ";";
  if (sc.avg === cc.avg) return sc.variance <= cc.variance ? ";" : ",";
  return sc.avg > cc.avg ? ";" : ",";
}

export function parseLocaleNumber(raw) {
  if (raw == null) return null;
  const source = String(raw).trim();
  if (!source || source === "---") return null;
  const compact = source.replace(/\s+/g, "");
  if (/^[+-]?\d+$/.test(compact)) return Number(compact);
  if (/^[+-]?\d+[.,]\d+$/.test(compact)) return Number(compact.replace(",", "."));
  if (/^[+-]?\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(compact)) {
    const lastComma = compact.lastIndexOf(",");
    const lastDot = compact.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const cleaned = compact.replace(/[.,]/g, (ch, idx) => (idx === (decimalSep === "," ? lastComma : lastDot) ? "." : ""));
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const fallback = Number(compact.replace(",", "."));
  return Number.isFinite(fallback) ? fallback : null;
}

function parseRawCsv(text, delimiter) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      delimiter,
      skipEmptyLines: false,
      complete: (results) => resolve(results.data || []),
      error: (err) => reject(err)
    });
  });
}

function pickDataRows(rawRows, headerIndex, columnCount) {
  const rows = [];
  for (let i = headerIndex + 1; i < rawRows.length; i += 1) {
    const row = (rawRows[i] || []).slice(0, columnCount).map((cell) => normalizeName(cell));
    const filled = row.some((cell) => cell !== "");
    if (!filled) continue;
    rows.push(row);
  }
  return rows;
}

function trimTrailingEmptyColumns(rawRows, headerIndex, headers) {
  let count = headers.length;
  while (count > 0) {
    const idx = count - 1;
    const headerEmpty = normalizeName(headers[idx]) === "";
    let hasData = false;
    for (let i = headerIndex + 1; i < rawRows.length; i += 1) {
      const cell = normalizeName(rawRows[i]?.[idx]);
      if (cell !== "") {
        hasData = true;
        break;
      }
    }
    if (headerEmpty && !hasData) {
      count -= 1;
      continue;
    }
    break;
  }
  return headers.slice(0, count);
}

function buildColumns(headers, dataRows) {
  const columns = headers.map((name, idx) => {
    let numericCount = 0;
    let totalCount = 0;
    for (let r = 0; r < Math.min(4000, dataRows.length); r += 1) {
      const value = dataRows[r]?.[idx];
      if (value == null || value === "" || value === "---") continue;
      totalCount += 1;
      if (parseLocaleNumber(value) != null) numericCount += 1;
    }
    const numericRatio = totalCount ? numericCount / totalCount : 0;
    return {
      key: `c${idx}`,
      name: toDefaultDisplayName(name, idx),
      unit: extractUnitFromHeader(name),
      customName: "",
      customUnit: "",
      type: inferColumnType(name, numericRatio),
      numericRatio
    };
  });
  const timeIdx = detectTimeColumn(columns.map((c) => c.name));
  if (columns[timeIdx]) {
    columns[timeIdx].type = "time";
    if (!columns[timeIdx].unit) columns[timeIdx].unit = "ms";
  }
  return { columns, timeIdx };
}

export async function parseCsvText(text, sourceName = "dataset.csv") {
  const delimiter = detectDelimiter(text);
  const rawRows = await parseRawCsv(text, delimiter);
  if (!rawRows.length) {
    throw new Error("CSV vide.");
  }
  const headerIndex = detectHeaderRow(rawRows);
  const rawHeaders = (rawRows[headerIndex] || []).map((h) => normalizeName(h));
  const headers = trimTrailingEmptyColumns(rawRows, headerIndex, rawHeaders);
  const columnCount = headers.length;
  if (!validateExpectedHeaders(headers)) {
    throw new Error("Format CSV invalide: en-tetes A3 a W3 inattendus.");
  }
  const rows = pickDataRows(rawRows, headerIndex, columnCount);
  if (!columnCount || !rows.length) {
    throw new Error("CSV invalide ou sans données exploitables.");
  }

  const { columns, timeIdx } = buildColumns(headers, rows);
  return {
    fileName: sourceName,
    delimiter,
    rowCount: rows.length,
    columnCount,
    headers,
    columns,
    timeColumnIndex: timeIdx,
    previewRows: rows.slice(0, 30),
    rows
  };
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsText(file);
  });
}

export async function parseCsvFile(file) {
  const text = await fileToText(file);
  return parseCsvText(text, file.name);
}

export function buildNumericColumn(rows, columnIndex) {
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    out[i] = parseLocaleNumber(rows[i][columnIndex]);
  }
  return out;
}
