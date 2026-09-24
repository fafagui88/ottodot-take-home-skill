export type BookingErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CLASS_STARTED"
  | "CLASS_FULL"
  | "ALREADY_BOOKED"
  | "BOOKING_NOT_PENDING"
  | "IDEMPOTENCY_KEY_REUSED"
  | "FORBIDDEN";

const STATUS: Record<BookingErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CLASS_STARTED: 409,
  CLASS_FULL: 409,
  ALREADY_BOOKED: 409,
  BOOKING_NOT_PENDING: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  FORBIDDEN: 403,
};

export class BookingError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: BookingErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BookingError";
    this.httpStatus = STATUS[code];
  }
}
