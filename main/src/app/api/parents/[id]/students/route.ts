import { listStudents } from "@/lib/booking";
import { handle, parseId } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => listStudents(parseId((await params).id, "parentId")));
}
