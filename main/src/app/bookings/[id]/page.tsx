"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, formatDate, newIdempotencyKey } from "../../api-client";

type Payment = {
  id: number;
  idempotencyKey: string;
  amountCents: number;
  status: string;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: string;
};
type Booking = {
  id: number;
  status: string;
  classId: number;
  classTitle: string;
  studentName: string;
  createdAt: string;
  confirmedAt: string | null;
  payments: Payment[];
};
type PayResult = { result: string; replayed: boolean; booking: Booking };

const MESSAGES: Record<string, string> = {
  confirmed: "Payment succeeded and the seat is yours. The child is on the roster.",
  payment_failed: "Payment failed. The child was NOT added to the roster. You can book again.",
  seat_unavailable: "Payment succeeded, but the last seat was taken by someone who paid first. Your payment was refunded.",
};

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  // One key per payment attempt: a double-click re-sends the same key, so it can't charge twice.
  const idemKey = useRef(newIdempotencyKey());

  const load = useCallback(() => {
    api<Booking>(`/api/bookings/${id}`).then(setBooking).catch(setError);
  }, [id]);

  useEffect(load, [load]);

  async function pay(outcome: "success" | "fail") {
    setPaying(true);
    setError(null);
    try {
      const res = await api<PayResult>(`/api/bookings/${id}/pay`, {
        method: "POST",
        headers: { "Idempotency-Key": idemKey.current },
        body: JSON.stringify({ outcome }),
      });
      setBooking(res.booking);
      setMessage(MESSAGES[res.result] ?? res.result);
      idemKey.current = newIdempotencyKey();
    } catch (e) {
      // On a network error the outcome is unknown: keep the key so a retry replays instead of re-charging.
      if (e instanceof ApiError) idemKey.current = newIdempotencyKey();
      setError(e as ApiError);
      load();
    } finally {
      setPaying(false);
    }
  }

  if (!booking) {
    return error ? <div className="alert error">{error.message}</div> : <p className="muted">Loading…</p>;
  }

  return (
    <>
      <h1>Booking #{booking.id}</h1>
      <div className="card">
        <p>
          <strong>{booking.studentName}</strong> → <strong>{booking.classTitle}</strong>
        </p>
        <p>
          Status: <span className={`badge ${booking.status}`}>{booking.status}</span>
        </p>
        <p className="muted">
          Created {formatDate(booking.createdAt)} · Confirmed {formatDate(booking.confirmedAt)}
        </p>

        {booking.status === "pending_payment" && (
          <>
            <h2>Mock payment</h2>
            <div className="actions">
              <button onClick={() => pay("success")} disabled={paying}>
                {paying ? "Processing…" : "Simulate payment success"}
              </button>
              <button className="danger" onClick={() => pay("fail")} disabled={paying}>
                Simulate payment failure
              </button>
            </div>
          </>
        )}

        {message && (
          <div className={`alert ${booking.status === "confirmed" ? "success" : "error"}`}>{message}</div>
        )}
        {error && (
          <div className="alert error">
            <strong>{error.code}</strong>: {error.message}
          </div>
        )}

        <div className="actions">
          <button className="secondary" onClick={load}>Refresh</button>
          <Link href={`/admin#class-${booking.classId}`}>View class roster</Link>
          {booking.status !== "pending_payment" && booking.status !== "confirmed" && (
            <Link href="/">Book again</Link>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Payment attempts</h2>
        {booking.payments.length === 0 ? (
          <p className="muted">No payment attempts yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Status</th><th>Amount</th><th>Provider ref</th><th>Reason</th><th>At</th></tr>
              </thead>
              <tbody>
                {booking.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                    <td>${(p.amountCents / 100).toFixed(2)}</td>
                    <td>{p.providerRef ?? "—"}</td>
                    <td>{p.failureReason ?? "—"}</td>
                    <td>{formatDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
