// The app stores and edits dates in ISO (YYYY-MM-DD, or YYYY-MM-DD HH:MM:SS
// for timestamps) — native <input type="date"> and every SQL date
// comparison need that format. These helpers are for DISPLAY only,
// converting to DD-MM-YYYY; never use them on a value headed back into an
// <input>, an API call, or a string comparison against another ISO date.
export function formatDate(isoDate) {
  if (!isoDate) return isoDate;
  const match = isoDate.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const [, y, m, d] = match;
  return `${d}-${m}-${y}`;
}

export function formatDateTime(isoDateTime) {
  if (!isoDateTime) return isoDateTime;
  const [datePart, timePart] = isoDateTime.split(/[ T]/);
  const formattedDate = formatDate(datePart);
  return timePart ? `${formattedDate} ${timePart.slice(0, 8)}` : formattedDate;
}
