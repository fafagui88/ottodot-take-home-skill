"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, formatDate } from "./api-client";

type Parent = { id: number; name: string; email: string };
type Student = { id: number; name: string; grade: number };
type TrialClass = {
  id: number;
  title: string;
  subject: string;
  startsAt: string;
  capacity: number;
  seatsLeft: number;
};

export default function BookPage() {
  const router = useRouter();
  const [parents, setParents] = useState<Parent[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [parentId, setParentId] = useState<number | "">("");
  const [studentId, setStudentId] = useState<number | "">("");
  const [classId, setClassId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api<Parent[]>("/api/parents").then(setParents).catch(setError);
    api<TrialClass[]>("/api/classes").then(setClasses).catch(setError);
  }, []);

  useEffect(() => {
    setStudentId("");
    setStudents([]);
    if (parentId) api<Student[]>(`/api/parents/${parentId}/students`).then(setStudents).catch(setError);
  }, [parentId]);

  async function submit() {
    if (!parentId || !studentId || !classId) return;
    setSubmitting(true);
    setError(null);
    try {
      const booking = await api<{ id: number }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({ parentId, studentId, classId }),
      });
      router.push(`/bookings/${booking.id}`);
    } catch (e) {
      setError(e as ApiError);
      // Seat counts may have changed; refresh them.
      api<TrialClass[]>("/api/classes").then(setClasses).catch(() => {});
      setSubmitting(false);
    }
  }

  const existingId = error?.body?.existingBookingId as number | undefined;

  return (
    <>
      <h1>Book a trial class</h1>
      <div className="card">
        <label htmlFor="parent">1. Parent (mock login)</label>
        <select id="parent" value={parentId} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Choose parent…</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <label htmlFor="student">2. Child</label>
        <select
          id="student"
          value={studentId}
          disabled={!parentId}
          onChange={(e) => setStudentId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">Choose child…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.name} (grade {s.grade})</option>
          ))}
        </select>

        <label>3. Trial class</label>
        <div className="class-list">
          {classes.map((c) => {
            const full = c.seatsLeft <= 0;
            return (
              <label key={c.id} className={`class-option ${full ? "disabled" : ""}`}>
                <input
                  type="radio"
                  name="class"
                  disabled={full}
                  checked={classId === c.id}
                  onChange={() => setClassId(c.id)}
                />
                <span>
                  <strong>{c.title}</strong> <span className="badge">{c.subject}</span>
                  <br />
                  <span className="muted">
                    {formatDate(c.startsAt)} · {full ? "Full" : `${c.seatsLeft} of ${c.capacity} seats left`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="actions">
          <button onClick={submit} disabled={!parentId || !studentId || !classId || submitting}>
            {submitting ? "Booking…" : "Book trial & continue to payment"}
          </button>
        </div>

        {error && (
          <div className="alert error">
            <strong>{error.code}</strong>: {error.message}
            {existingId && (
              <> — <Link href={`/bookings/${existingId}`}>view existing booking #{existingId}</Link></>
            )}
          </div>
        )}
      </div>
      <p className="muted">
        Seats are not held while you pay. A seat is only taken when payment succeeds, and if someone else
        took the last seat first, your payment is refunded automatically.
      </p>
    </>
  );
}
