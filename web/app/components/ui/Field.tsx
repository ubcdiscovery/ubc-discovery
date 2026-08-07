import type { ReactNode } from "react";
import { Label } from "~/components/ui/Label";

type FieldProps = {
  label: string;
  htmlFor: string;
  description?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, description, children }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {description && <p className="text-xs text-muted">{description}</p>}
      {children}
    </div>
  );
}
