import { cn } from "@/lib/utils"

export function OxyMark({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid size-10 place-items-center rounded-[18px] bg-[conic-gradient(from_180deg_at_50%_50%,var(--auth-accent,#22b6a8),var(--auth-highlight,#f6c978),var(--auth-accent,#22b6a8))] text-[color:var(--auth-canvas,#fdfcf7)] shadow-[0_12px_30px_-18px_rgba(16,115,127,0.7)]",
        className
      )}
      {...props}
    >
      <span className="text-xs font-semibold">O</span>
    </div>
  )
}
