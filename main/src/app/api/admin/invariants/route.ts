import { findInvariantViolations } from "@/lib/booking";
import { handle } from "@/lib/http";

// Reconciliation probe: empty `violations` means seat counters match confirmed bookings.
export async function GET() {
  return handle(async () => {
    const violations = await findInvariantViolations();
    return { ok: violations.length === 0, violations };
  });
}
