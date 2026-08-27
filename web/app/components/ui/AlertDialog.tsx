import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { HTMLAttributes } from "react";
import { Button, type ButtonProps } from "~/components/ui/Button";
import { cn } from "~/lib/utils";

// Adapted from the shadcn/ui Base UI AlertDialog flavor, styled with this
// app's semantic tokens. Dialogs here are controlled (open state lives in the
// route or composite component), so Action and Cancel are plain Buttons the
// consumer wires up instead of auto-closing primitives.

export function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root {...props} />;
}

export function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/55" />
      <AlertDialogPrimitive.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2.5rem)] max-w-130 -translate-1/2 border-2 border-ink bg-bg p-6 shadow-hard-lg outline-none md:p-8",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn(
        "font-display text-3xl font-extrabold leading-none tracking-tight md:text-4xl",
        className,
      )}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm/relaxed text-ink-soft", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex gap-2", className)} {...props} />;
}

export function AlertDialogAction({ className, ...props }: ButtonProps) {
  return <Button className={className} {...props} />;
}

export function AlertDialogCancel({ className, variant = "ghost", ...props }: ButtonProps) {
  return <Button variant={variant} className={className} {...props} />;
}
