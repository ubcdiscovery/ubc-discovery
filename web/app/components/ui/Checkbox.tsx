import type { InputHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className
      )}
      {...props}
    />
  );
}
