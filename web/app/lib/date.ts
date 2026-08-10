const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function fmtTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`;
}

export function fmtRange(a: Date, b: Date): string {
  return `${fmtTime(a)}-${fmtTime(b)}`;
}

export function fmtDay(d: Date): string {
  return `${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

export function fmtMonth(d: Date): string {
  return MONTH[d.getMonth()].toUpperCase();
}

export function fmtDate02(d: Date): string {
  return String(d.getDate()).padStart(2, "0");
}

/** "4:00 PM" — padded minutes, uppercase meridiem. */
export function fmtClock(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ap}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `now` to `d`, ignoring clock time. */
export function daysUntil(d: Date, now: Date = new Date()): number {
  return Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
}

/**
 * A date-time label that gets more specific the further out the event is:
 * "TODAY · 4:00 PM", "TOMORROW · 5:00 PM", "SUN · 4:00 PM" inside a week,
 * then "AUG 20 · 6:30 PM".
 */
export function relativeDateTime(
  d: Date,
  now: Date = new Date()
): { label: string; isToday: boolean } {
  const days = daysUntil(d, now);
  const time = fmtClock(d);

  if (days === 0) return { label: `TODAY · ${time}`, isToday: true };
  if (days === 1) return { label: `TOMORROW · ${time}`, isToday: false };
  if (days > 1 && days < 7) {
    return { label: `${WEEKDAY[d.getDay()].toUpperCase()} · ${time}`, isToday: false };
  }
  return { label: `${fmtMonth(d)} ${d.getDate()} · ${time}`, isToday: false };
}
