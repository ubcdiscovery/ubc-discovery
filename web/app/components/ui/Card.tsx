import type { HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("border border-ink bg-surface p-4 md:p-5", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-ink pb-2", className)} {...props} />;
}

export function CardTitle({ children, className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("font-mono text-xs font-bold uppercase tracking-wider text-accent", className)}
      {...props}
    >
      {children}
    </h2>
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("pt-5", className)} {...props} />;
}
