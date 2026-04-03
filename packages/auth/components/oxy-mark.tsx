import { cn } from "@/lib/utils"

export function OxyMark({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid size-10 place-items-center rounded-[18px] bg-[conic-gradient(from_180deg_at_50%_50%,var(--auth-accent,#005c67),var(--auth-highlight,hsl(185_40%_90%)),var(--auth-accent,#005c67))] text-[color:var(--auth-canvas,hsl(0_0%_99%))] shadow-[0_12px_30px_-18px_rgba(0,92,103,0.5)]",
        className
      )}
      {...props}
    >
      <span className="text-xs font-semibold">O</span>
    </div>
  )
}
