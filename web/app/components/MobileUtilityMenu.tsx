import { useEffect, useRef, useState } from "react";
import { FiMenu } from "react-icons/fi";
import { Link } from "react-router";
import { NavIconButton } from "~/components/NavIconButton";
import { useTheme } from "~/lib/theme";

export function MobileUtilityMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <NavIconButton
        aria-label="Open site menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FiMenu aria-hidden="true" className="size-5" />
      </NavIconButton>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-48 border-2 border-ink bg-surface shadow-hard"
        >
          <Link
            to="/organizers"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center border-b border-rule-soft px-3 font-mono text-xs font-bold tracking-wide text-ink uppercase hover:bg-accent-soft"
          >
            For organizers
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={toggleTheme}
            className="flex min-h-11 w-full items-center px-3 text-left font-mono text-xs font-bold tracking-wide text-ink uppercase hover:bg-accent-soft"
          >
            {resolvedTheme === "dark" ? "Use light mode" : "Use dark mode"}
          </button>
        </div>
      )}
    </div>
  );
}
