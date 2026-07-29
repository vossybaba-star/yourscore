/** DEV-ONLY visual preview of the Captain Assist card — gated below.
 *
 *  This must be a Server Component: `notFound()` only produces a real HTTP
 *  404 when it is thrown during server rendering. Calling it from inside a
 *  "use client" page (the previous shape of this file) merely swaps the DOM
 *  after hydration — the prerendered HTML still ships with a 200 status,
 *  which is exactly the "still ends up in production" failure this exists to
 *  prevent. The actual preview UI lives in ./preview.tsx and is only ever
 *  imported past this gate. */
import { notFound } from "next/navigation";
import CaptainAssistPreview from "./preview";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CaptainAssistPreview />;
}
