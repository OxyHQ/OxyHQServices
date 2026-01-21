"use client"

import * as React from "react"
import { OTPInput, OTPInputContext, type OTPInputProps } from "input-otp"
import { cn } from "@/lib/utils"

const InputOTP = React.forwardRef<React.ElementRef<typeof OTPInput>, OTPInputProps>(
    ({ className, containerClassName, ...props }, ref) => (
        <OTPInput
            ref={ref}
            containerClassName={cn("flex items-center gap-2", containerClassName)}
            className={cn("flex items-center gap-2", className)}
            {...props}
        />
    )
)
InputOTP.displayName = "InputOTP"

const InputOTPGroup = React.forwardRef<
    React.ElementRef<"div">,
    React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2", className)} {...props} />
))
InputOTPGroup.displayName = "InputOTPGroup"

const InputOTPSeparator = React.forwardRef<
    React.ElementRef<"div">,
    React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mx-2", className)} {...props} />
))
InputOTPSeparator.displayName = "InputOTPSeparator"

const InputOTPSlot = React.forwardRef<
    React.ElementRef<"div">,
    { index: number } & React.ComponentPropsWithoutRef<"div">
>(({ index, className, ...props }, ref) => {
    const inputOTPContext = React.useContext(OTPInputContext)
    const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index]
    return (
        <div
            ref={ref}
            className={cn(
                "flex h-16 w-12 items-center justify-center rounded-md border text-xl transition-all",
                isActive && "border-primary shadow-md",
                hasFakeCaret && "caret",
                className
            )}
            {...props}
        >
            {char}
        </div>
    )
})
InputOTPSlot.displayName = "InputOTPSlot"

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot }
