import { payBooking } from "@/lib/booking";
import { BookingError } from "@/lib/errors";
import { handle, parseId, readJson } from "@/lib/http";

// POST { outcome: "success" | "fail", delayMs? }  + header Idempotency-Key
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const bookingId = parseId((await params).id, "bookingId");
    const body = await readJson(req);

    const outcome = body.outcome;
    if (outcome !== "success" && outcome !== "fail") {
      throw new BookingError("VALIDATION_ERROR", 'outcome must be "success" or "fail"');
    }
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 100) {
      throw new BookingError("VALIDATION_ERROR", "Idempotency-Key header is required (max 100 chars)");
    }
    const delayMs = Math.min(Math.max(Number(body.delayMs) || 0, 0), 10_000);

    return payBooking({ bookingId, outcome, idempotencyKey, delayMs });
  });
}
