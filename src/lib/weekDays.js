/**
 * Israeli week: Sunday (יום ראשון) is day 1, Saturday (שבת) is day 7.
 * Plans store English day keys; these helpers give the Hebrew label and put
 * any plan (including older Monday-first ones) into Sunday → Saturday order.
 */

export const WEEK_DAYS = [
  { key: "Sunday", label: "יום ראשון" },
  { key: "Monday", label: "יום שני" },
  { key: "Tuesday", label: "יום שלישי" },
  { key: "Wednesday", label: "יום רביעי" },
  { key: "Thursday", label: "יום חמישי" },
  { key: "Friday", label: "יום שישי" },
  { key: "Saturday", label: "שבת" },
];

const HEBREW_ALIASES = {
  "ראשון": "Sunday", "שני": "Monday", "שלישי": "Tuesday", "רביעי": "Wednesday",
  "חמישי": "Thursday", "שישי": "Friday", "שבת": "Saturday",
};

/** Maps "Sunday" / "sunday" / "ראשון" / "יום ראשון" to the English key, or null. */
export function dayKey(name) {
  const s = String(name || "").trim();
  const en = WEEK_DAYS.find(d => d.key.toLowerCase() === s.toLowerCase());
  if (en) return en.key;
  return HEBREW_ALIASES[s.replace(/^יום\s+/, "")] || null;
}

export function dayLabel(name) {
  const key = dayKey(name);
  return key ? WEEK_DAYS.find(d => d.key === key).label : name;
}

/** Returns the plan's days in Sunday → Saturday order (unknown names keep their place at the end). */
export function sortDays(days) {
  if (!Array.isArray(days)) return [];
  const index = d => {
    const i = WEEK_DAYS.findIndex(w => w.key === dayKey(d.day_name));
    return i === -1 ? WEEK_DAYS.length : i;
  };
  return days.map((d, i) => ({ d, i })).sort((a, b) => index(a.d) - index(b.d) || a.i - b.i).map(x => x.d);
}
