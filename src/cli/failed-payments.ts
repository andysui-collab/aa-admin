// npm run failed-payments
// Prints payments that failed in the last 24 hours. Prints nothing if there were none.
// (On Vercel, api/failed-payments.ts runs the same check daily and sends it to n8n.)

import { failedPaymentsMessage, findFailedPayments } from "../failed.js";

const failed = await findFailedPayments();
if (failed.length) console.log(failedPaymentsMessage(failed));
