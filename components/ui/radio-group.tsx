import * as React from "react"
import { CheckCircle2 } from "lucide-react"

import { cn } from "@/lib/utils"

const RadioGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean }
>(({ className, disabled, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("grid gap-2", className)}
      {...props}
      data-disabled={disabled ? "" : undefined}
    />
  )
})
RadioGroup.displayName = "RadioGroup"

const RadioGroupItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: string, disabled?: boolean }
>(({ className, disabled, ...props }, ref) => {
  return (
    <div ref={ref}>
      <input
        type="radio"
        className="peer absolute h-4 w-4 opacity-0"
        disabled={disabled}
        {...props}
      />
      <div
        className={cn(
          "h-4 w-4 rounded-full border border-primary text-primary ring-offset-background transition-colors hover:bg-primary/10 hover:text-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          className
        )}
      >
        <CheckCircle2 className="h-4 w-4 scale-0 transition-transform peer-checked:scale-100" />
      </div>
    </div>
  )
})
RadioGroupItem.displayName = "RadioGroupItem"

export { RadioGroup, RadioGroupItem }