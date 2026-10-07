/**
 * Lecture CSV (RFC 4180 : guillemets, guillemets doublés, retours à la ligne
 * dans les champs, BOM).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Lignes sous forme d'objets, à partir de la première ligne contenant
 * `requiredColumn` (certains exports LinkedIn commencent par des notes).
 */
export function csvRecords(text: string, requiredColumn: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim() === requiredColumn));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex]!.map((cell) => cell.trim());
  return rows
    .slice(headerIndex + 1)
    .map((row) =>
      Object.fromEntries(header.map((name, index) => [name, (row[index] ?? "").trim()])),
    );
}
