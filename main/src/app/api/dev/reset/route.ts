import { BookingError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { resetDatabase } from "@/lib/reset";

// Demo helper: re-create schema + seed. Disabled unless ALLOW_DEV_RESET=true.
export async function POST() {
  return handle(async () => {
    if (process.env.ALLOW_DEV_RESET !== "true") {
      throw new BookingError("FORBIDDEN", "Reset is disabled (set ALLOW_DEV_RESET=true)");
    }
    await resetDatabase();
    return { ok: true };
  });
}
