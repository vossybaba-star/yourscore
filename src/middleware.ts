import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// An ad link built without its "?" puts the whole tracking string in the path:
// /utm_source=x&utm_medium=paid&... — that matches no route, so a paid click
// lands on a 404, and AcquisitionCapture (which reads location.search) records
// nothing. Put the params back where they belong so the visit still counts.
const UTM_IN_PATH = /^\/(utm_[a-z]+=.*)$/i;

export async function middleware(request: NextRequest) {
  const stranded = UTM_IN_PATH.exec(request.nextUrl.pathname);
  if (stranded) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = `?${stranded[1]}`;
    return NextResponse.redirect(url, 308);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
