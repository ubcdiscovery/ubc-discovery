import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 border font-mono text-xs font-bold uppercase tracking-wide outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "border-accent bg-accent text-on-color hover:border-ink hover:bg-ink",
        secondary: "border-ink bg-surface text-ink hover:bg-accent-soft",
        danger: "border-danger bg-surface text-danger hover:bg-danger hover:text-on-color",
        ghost: "border-transparent bg-transparent text-muted hover:border-ink hover:text-ink",
      },
      size: {
        sm: "px-3 py-2",
        md: "px-4 py-2.5",
        lg: "px-4 py-3",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, size, variant, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ size, variant }), className)} {...props} />;
}
