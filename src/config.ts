// Business rules for reconciliation. Edit this file when plans or prices change.

// Ignore Stripe activity and lessons before this date.
export const START_DATE = "2026-03-01";

export const TIMEZONE = "Australia/Melbourne";

// The master sheet (public link). Tutors tab, column E, lists each tutor's tracker sheet.
export const MASTER_SHEET_ID = "1H8dliRwRh_BlvOZNCubAQIxQ9dkhIBa0nRai9BP9Jjw";
export const MASTER_CLIENTS_GID = "353391691";

// Hours per week for prices whose product name is misleading. Checked first.
export const PRICE_HOURS: Record<string, number> = {
  price_1UWtydE3ALJUDeBodBY85BSJ: 1, // $75/wk, product named "Maths and English Program", but 1 lesson
  price_1TwgaYE3ALJUDeBoIrOUfU8A: 1, // $65/wk, product named "Standard Tutoring Plan (2x a week)", but 1 lesson
};

// Hours per unit, matched against the product name (or line description). First match wins.
// null = we can't convert this to hours; the dollars are shown for manual review instead.
export const NAME_RULES: [RegExp, number | null][] = [
  [/deposit/i, 0],
  [/transformation program - \(single subject weekly\)/i, 1],
  [/transformation|mindmastery/i, null],
  [/additional lesson/i, 0.5],
  [/additional session \(1hr\)/i, 1],
  [/2 lessons/i, 2],
  [/4x a week/i, 4],
  [/2x a week|maths? (and|&) english/i, 2],
  [/risk-free|1x a week|single subject|special needs/i, 1],
];

// A $0 "Trial period" invoice still covers that week's lessons (the free first week).
export const TRIAL_COUNTS_AS_BILLED = true;

// Billing and lessons happen on different days of the week, so a balance within
// this many weeks' worth of the family's plan is normal timing, not a problem.
export const TOLERANCE_WEEKS = 1;
