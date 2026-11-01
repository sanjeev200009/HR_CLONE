// CSV export, shared by the attendance and leave reports.
//
// Built in the browser from rows already on screen: no server endpoint, no file
// storage, no extra dependency. Excel export stays out of the MVP — Excel opens
// CSV perfectly well.

/**
 * Quote every cell and neutralise formula injection.
 *
 * A value beginning = + - @ is executed by Excel when the file is opened. An
 * employee types their own leave reason and correction reason, so this is
 * reachable user input, not paranoia.
 */
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Rows (header first) to a downloaded file. */
export function downloadCsv(rows: (string | number | null | undefined)[][], filename: string) {
  // CRLF because the audience is Excel on Windows.
  const csv = rows.map((cols) => cols.map(csvCell).join(",")).join("\r\n");
  // BOM, or Excel mangles Sinhala and Tamil names.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
