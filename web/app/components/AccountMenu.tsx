import { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiLogOut, FiUser } from "react-icons/fi";
import { Link, useNavigate } from "react-router";
import { useAuth } from "~/lib/auth";

export function AccountMenu({
  memberName,
  compact = false,
}: {
  memberName: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { signOut, state } = useAuth();
  const initial = memberName[0]?.toUpperCase() ?? "?";
  const avatarUrl = state.status === "member" ? state.profile.profile_picture_url : null;

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    navigate("/");
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={
          compact
            ? "flex h-6 w-6 items-center justify-center bg-accent text-white font-display text-[12px] font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            : "flex items-center gap-2 border border-transparent px-1.5 py-1 hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        }
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={memberName}
            className={`object-cover ${compact ? "h-6 w-6" : "h-7 w-7"}`}
          />
        ) : (
          <span
            className={`flex items-center justify-center bg-gradient-to-br from-accent to-[#7990FF] text-white font-display font-extrabold ${
              compact ? "h-6 w-6 text-[12px]" : "h-7 w-7 text-[13px]"
            }`}
          >
            {initial}
          </span>
        )}
        {!compact && (
          <>
            <span className="max-w-[140px] truncate font-mono text-[11px] font-semibold">
              {memberName}
            </span>
            <FiChevronDown
              aria-hidden="true"
              className={`h-3.5 w-3.5 text-muted transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-44 border-2 border-ink bg-surface shadow-[4px_4px_0_var(--color-ink)]"
        >
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-b border-rule-soft px-3 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wide text-ink hover:bg-accent-soft"
          >
            <FiUser aria-hidden="true" className="h-3.5 w-3.5" />
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[11px] font-bold uppercase tracking-wide text-ink hover:bg-accent-soft"
          >
            <FiLogOut aria-hidden="true" className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
