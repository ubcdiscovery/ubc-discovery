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
