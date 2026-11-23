/** True on Saturday or Sunday (UTC). */
export function isWeekend(date) {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}

/** Add n business days (Mon–Fri, UTC) to a date. Returns a new Date. */
export function addBusinessDays(date, n) {
  const result = new Date(date.getTime());
  let added = 0;
  while (added < n) {
    result.setUTCDate(result.getUTCDate() + 1);
    added += 1;
    if (isWeekend(result)) result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}
