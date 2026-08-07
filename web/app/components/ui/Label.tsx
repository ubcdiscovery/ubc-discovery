import type { LabelHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("font-mono text-xs font-bold uppercase tracking-wide text-muted", className)}
      {...props}
    />
  );
}
