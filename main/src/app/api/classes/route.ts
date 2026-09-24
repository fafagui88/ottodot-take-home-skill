import { listClasses } from "@/lib/booking";
import { handle } from "@/lib/http";

export async function GET() {
  return handle(() => listClasses());
}
