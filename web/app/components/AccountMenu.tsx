import { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiInbox, FiLogOut, FiUser } from "react-icons/fi";
import { Link, useNavigate } from "react-router";
import { useAuth } from "~/lib/auth";

export function AccountMenu({ memberName }: { memberName: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { signOut, state } = useAuth();
  const initial = memberName[0]?.toUpperCase() ?? "?";
  const avatarUrl = state.status === "member" ? state.profile.profile_picture_url : null;
  const isAdmin = state.status === "member" && state.profile.is_admin;

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
    void navigate("/");
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 border border-transparent px-1.5 py-1 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={memberName} className="size-7 object-cover" />
        ) : (
          <span className="flex size-7 items-center justify-center bg-linear-to-br from-avatar-start to-avatar-end font-display text-sm font-extrabold text-on-color">
            {initial}
          </span>
        )}
        <span className="max-w-35 truncate font-mono text-xs font-semibold">{memberName}</span>
        <FiChevronDown
          aria-hidden="true"
          className={`size-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-44 border-2 border-ink bg-surface shadow-hard"
        >
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-b border-rule-soft px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wide text-ink hover:bg-accent-soft"
          >
            <FiUser aria-hidden="true" className="size-3.5" />
            Profile
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-rule-soft px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wide text-ink hover:bg-accent-soft"
            >
              <FiInbox aria-hidden="true" className="size-3.5" />
              Review queue
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-xs font-bold uppercase tracking-wide text-ink hover:bg-accent-soft"
          >
            <FiLogOut aria-hidden="true" className="size-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
