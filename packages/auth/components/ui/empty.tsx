import { cn } from "@/lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "border-border bg-background flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center",
        className
      )}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="empty-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("text-muted-foreground max-w-sm text-sm", className)}
      {...props}
    />
  )
}

function EmptyActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-actions"
      className={cn("mt-4 flex flex-wrap items-center justify-center gap-2", className)}
      {...props}
    />
  )
}

export { Empty, EmptyTitle, EmptyDescription, EmptyActions }
