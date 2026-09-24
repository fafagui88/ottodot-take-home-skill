"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, formatDate } from "../api-client";

type Entry = {
  bookingId: number;
  status: string;
  studentName: string;
  grade: number;
  parentName: string;
  confirmedAt: string | null;
  createdAt: string;
};
type Roster = {
  class: { id: number; title: string; subject: string; startsAt: string; capacity: number; confirmedCount: number; seatsLeft: number };
  confirmed: Entry[];
  other: Entry[];
};
type Invariants = { ok: boolean; violations: unknown[] };

export default function AdminPage() {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [invariants, setInvariants] = useState<Invariants | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const classes = await api<{ id: number }[]>("/api/classes");
      setRosters(await Promise.all(classes.map((c) => api<Roster>(`/api/classes/${c.id}/roster`))));
      setInvariants(await api<Invariants>("/api/admin/invariants"));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reset() {
    if (!confirm("Reset all demo data to the seed?")) return;
    setResetting(true);
    try {
      await api("/api/dev/reset", { method: "POST" });
      await load();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <h1>Trial class rosters</h1>
      <div className="actions" style={{ marginBottom: 16 }}>
        <button className="secondary" onClick={load}>Refresh</button>
        <button className="danger" onClick={reset} disabled={resetting}>
          {resetting ? "Resetting…" : "Reset demo data"}
        </button>
        {invariants && (
          <span className={`badge ${invariants.ok ? "confirmed" : "payment_failed"}`} style={{ alignSelf: "center" }}>
            {invariants.ok ? "Invariants OK: seat counters match confirmed bookings" : "Invariant violation!"}
          </span>
        )}
      </div>
      {error && <div className="alert error"><strong>{error.code}</strong>: {error.message}</div>}

      {rosters.map((r) => (
        <div className="card" key={r.class.id} id={`class-${r.class.id}`}>
          <h2>
            {r.class.title} <span className="badge">{r.class.subject}</span>
          </h2>
          <p className="muted">
            {formatDate(r.class.startsAt)} · {r.class.confirmedCount}/{r.class.capacity} confirmed ·{" "}
            {r.class.seatsLeft} seats left
          </p>

          <strong>Confirmed roster</strong>
          {r.confirmed.length === 0 ? (
            <p className="muted">No confirmed students yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Student</th><th>Grade</th><th>Parent</th><th>Confirmed at</th><th>Booking</th></tr></thead>
                <tbody>
                  {r.confirmed.map((e) => (
                    <tr key={e.bookingId}>
                      <td>{e.studentName}</td>
                      <td>{e.grade}</td>
                      <td>{e.parentName}</td>
                      <td>{formatDate(e.confirmedAt)}</td>
                      <td><Link href={`/bookings/${e.bookingId}`}>#{e.bookingId}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {r.other.length > 0 && (
            <>
              <p style={{ marginTop: 12 }}><strong>Other bookings (not on roster)</strong></p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Student</th><th>Parent</th><th>Status</th><th>Created</th><th>Booking</th></tr></thead>
                  <tbody>
                    {r.other.map((e) => (
                      <tr key={e.bookingId}>
                        <td>{e.studentName}</td>
                        <td>{e.parentName}</td>
                        <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                        <td>{formatDate(e.createdAt)}</td>
                        <td><Link href={`/bookings/${e.bookingId}`}>#{e.bookingId}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}
    </>
  );
}
