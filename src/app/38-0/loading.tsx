// Route-level loading shell: paints the page background immediately so tab
// navigation never flashes dark/blank while the client bundle loads. No
// spinner on purpose — the page's own skeletons take over once mounted.
export default function Loading() {
  return <div className="min-h-screen bg-bg" />;
}
