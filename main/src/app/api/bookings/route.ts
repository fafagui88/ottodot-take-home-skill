import { createBooking } from "@/lib/booking";
import { handle, parseId, readJson } from "@/lib/http";

// POST { parentId, studentId, classId } -> 201 booking (pending_payment)
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    return createBooking({
      parentId: parseId(body.parentId, "parentId"),
      studentId: parseId(body.studentId, "studentId"),
      classId: parseId(body.classId, "classId"),
    });
  }, 201);
}
