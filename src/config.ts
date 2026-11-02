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
  price_1TSF9cE3ALJUDeBoLJtdtYOq: 1, // $60/wk "Additional Lesson (1x a week)" is a full hour ($30 and $40 are half hours)
};

// Upfront programs buy a block of hours, often paid in instalments, so they're converted by
// dollars paid: e.g. Advanced is $3,200 for 40 hours, so a $1,070 instalment = 13.4 hours.
export const PROGRAM_DOLLARS_PER_HOUR: [RegExp, number][] = [
  [/transformation program \(advanced\)/i, 3200 / 40],
  [/transformation program \(standard\)/i, 1800 / 20],
  [/transformation program \(maths? & english\) - 4x \$750/i, 3000 / 40],
  [/transformation program \(maths? & english\) - 4x \$800/i, 3200 / 40],
];

// Payments made without an invoice (e.g. payment links) have no product attached.
// Hours come from a number in the description ("8 owed sessions"), else from this table by amount.
export const ONE_OFF_PAYMENT_HOURS: Record<number, number> = {
  1800: 20, // 20-hour package
};

// Hours per unit, matched against the product name (or line description). First match wins.
// null = we can't convert this to hours; the dollars are shown for manual review instead.
export const NAME_RULES: [RegExp, number | null][] = [
  [/deposit/i, 0],
  [/transformation program - \(single subject weekly\)/i, 1],
  [/mindmastery/i, 0], // very old program, ignored
  [/transformation/i, null],
  [/additional lesson/i, 0.5],
  [/additional session \(1hr\)/i, 1],
  [/2 lessons/i, 2],
  [/4x a week/i, 4],
  [/2x a week|maths? (and|&) english/i, 2],
  [/risk-free|1x a week|single subject|special needs/i, 1],
];

// The $0 "Trial period" invoice only delays the first charge until after the first lesson;
// it doesn't pay for a lesson (there are no free first lessons).
export const TRIAL_COUNTS_AS_BILLED = false;

// Billing and lessons happen on different days of the week, so a balance within
// this many weeks' worth of the family's plan is normal timing, not a problem.
export const TOLERANCE_WEEKS = 1;
