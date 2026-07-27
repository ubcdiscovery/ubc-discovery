import type { ButtonHTMLAttributes } from "react";

const NAV_ICON_BUTTON_CLASS =
  "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center border border-transparent text-muted transition-colors hover:border-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

export function NavIconButton({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`${NAV_ICON_BUTTON_CLASS} ${className}`}
      {...props}
    />
  );
}
