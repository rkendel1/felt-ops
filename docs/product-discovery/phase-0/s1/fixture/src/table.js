/** Render rows (objects with the same keys) as a Markdown table. */
export function renderTable(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}
