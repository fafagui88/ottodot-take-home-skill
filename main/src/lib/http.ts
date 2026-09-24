import { NextResponse } from "next/server";
import { BookingError } from "./errors";

/** Wraps a route handler: BookingError -> typed JSON error, anything else -> 500. */
export async function handle(fn: () => Promise<unknown>, successStatus = 200): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(), { status: successStatus });
  } catch (err) {
    if (err instanceof BookingError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, ...err.details } },
        { status: err.httpStatus },
      );
    }
    console.error(err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Internal server error" } }, { status: 500 });
  }
}

export function parseId(value: unknown, name: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BookingError("VALIDATION_ERROR", `${name} must be a positive integer`);
  }
  return n;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object") return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new BookingError("VALIDATION_ERROR", "Request body must be a JSON object");
}
