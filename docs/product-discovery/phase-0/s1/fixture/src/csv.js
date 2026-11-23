/** Parse CSV text into an array of rows (arrays of strings). Supports "quoted" fields. */
export function parseCSV(text) {
  return text.split(/\r?\n/).filter((line) => line.length > 0).map((line) =>
    line.split(",").map((field) => field.replace(/^"(.*)"$/, "$1").replace(/""/g, '"')),
  );
}
