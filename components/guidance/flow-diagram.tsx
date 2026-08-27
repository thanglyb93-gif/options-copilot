import type { FlowBoxDef } from "@/lib/guidance-content";

function FlowBox({ label, targetId, planned }: FlowBoxDef) {
  const classes = planned
    ? "border-dashed border-border/60 text-muted"
    : "border-border bg-background text-foreground hover:border-accent/50";

  const content = (
    <div className={`rounded-md border px-3 py-2 text-center text-xs font-medium transition-colors ${classes}`}>
      {label}
    </div>
  );

  if (!targetId) return content;

  return (
    <a href={`#${targetId}`} className="block">
      {content}
    </a>
  );
}

export function FlowDiagram({ stages }: { stages: FlowBoxDef[][] }) {
  return (
    <div className="flex flex-col items-stretch gap-2">
      {stages.map((stage, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-stretch justify-center gap-2">
            {stage.map((box, j) => (
              <div key={j} className="min-w-[9rem] flex-1 sm:flex-none">
                <FlowBox {...box} />
              </div>
            ))}
          </div>
          {i < stages.length - 1 && <div className="text-center text-muted">↓</div>}
        </div>
      ))}
    </div>
  );
}
