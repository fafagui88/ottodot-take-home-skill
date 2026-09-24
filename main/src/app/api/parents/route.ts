import { listParents } from "@/lib/booking";
import { handle } from "@/lib/http";

// Auth is mocked: the UI lets you "log in" by picking a parent.
export async function GET() {
  return handle(() => listParents());
}
