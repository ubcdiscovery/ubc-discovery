import type { InputHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full border border-ink bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:font-mono file:text-xs file:font-bold",
        className
      )}
      {...props}
    />
  );
}
