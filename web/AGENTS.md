# Web Frontend Guidelines

These instructions apply to all files under `web/` and supplement the repository-level `AGENTS.md`.

## Theme colors

- Treat the semantic color tokens in `app/app.css` as the frontend color source of truth.
- In components, use their Tailwind utilities: `bg-bg`, `bg-surface`, `text-ink`, `text-ink-soft`, `text-muted`, `border-rule`, `border-rule-soft`, `text-accent`, `bg-accent`, `bg-accent-soft`, and `bg-hi`.
- Choose tokens by meaning, not by their current light-theme value. For example, use `border-ink` for a high-contrast outline; do not use `border-white` merely because `ink` is near-white in dark mode.
- Do not hardcode presentation colors in component classes or inline styles. This includes Tailwind palette colors such as `text-white` or `bg-black`, arbitrary values such as `text-[#fff]`, and literal CSS values such as `color: "#fff"`.
- If the existing vocabulary cannot express a required role, add a semantic `--color-*` token to `app/app.css`. Define it for the default theme, the explicit dark theme, and the system dark-mode fallback before using its Tailwind utility.
- Keep deliberately theme-independent colors exceptional. Use them only for externally defined brand colors or data-driven content, and add a short comment explaining why a semantic theme token is inappropriate.
- Check new or changed color interactions in both light and dark themes, including hover, active, focus, disabled, and selected states.
