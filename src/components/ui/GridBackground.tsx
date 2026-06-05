// Faint grid overlay used as a page background. Opacity is parameterised so each
// page keeps its exact previous value (no visual change on extraction).
export function GridBackground({ opacity = 0.025 }: { opacity?: number }) {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,${opacity}) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,${opacity}) 1px,transparent 1px)`,
        backgroundSize: "40px 40px",
      }}
    />
  );
}
