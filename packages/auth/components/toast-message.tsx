"use client"

import { useEffect } from "react"
import { toast } from "sonner"

type ToastMessageProps = {
  title: string
  description?: string
  variant?: "default" | "error" | "success"
}

export function ToastMessage({
  title,
  description,
  variant = "default",
}: ToastMessageProps) {
  useEffect(() => {
    if (!title) {
      return
    }

    if (variant === "error") {
      toast.error(title, { description })
      return
    }

    if (variant === "success") {
      toast.success(title, { description })
      return
    }

    toast(title, { description })
  }, [title, description, variant])

  return null
}
