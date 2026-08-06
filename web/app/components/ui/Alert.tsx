import type { HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "error" | "success" | "info";
};

const alertVariants = {
  error: "border-danger text-danger",
  success: "border-accent text-ink",
  info: "border-ink text-ink",
};

export function Alert({ className, variant = "info", role, ...props }: AlertProps) {
  return (
    <div
      role={role ?? (variant === "error" ? "alert" : "status")}
      className={cn("border p-3 text-sm", alertVariants[variant], className)}
      {...props}
    />
  );
}
