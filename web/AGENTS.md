# Web Frontend Guidelines

These instructions apply to all files under `web/` and supplement the repository-level `AGENTS.md`.

## Admin Dashboard Direction

- The admin dashboard should be easy to use, easy to read, and easy to maintain. Prefer simplicity and minimal implementation code over visual polish.
- The admin UI does not need to match the public Discovery design language exactly; use a plain, conventional dashboard style when that reduces complexity.
- Use shadcn/ui source-owned primitives for common admin controls where useful. Keep admin route composition, auth gating, API adapters, query behavior, and Event Listing domain logic explicit in the web app.
- Avoid introducing a full CRUD/admin framework until repeated admin resources and workflows justify its complexity.
- Event Listing editing must support replacing the event image through the protected presigned-upload flow. Keep image upload independent from metadata Save and show clear upload, success, and failure states.

## Theme colors

- Treat the semantic color tokens in `app/app.css` as the frontend color source of truth.
- In components, use their Tailwind utilities: `bg-bg`, `bg-surface`, `text-ink`, `text-ink-soft`, `text-muted`, `border-rule`, `border-rule-soft`, `text-accent`, `bg-accent`, `bg-accent-soft`, and `bg-hi`.
- Choose tokens by meaning, not by their current light-theme value. For example, use `border-ink` for a high-contrast outline; do not use `border-white` merely because `ink` is near-white in dark mode.
- Do not hardcode presentation colors in component classes or inline styles. This includes Tailwind palette colors such as `text-white` or `bg-black`, arbitrary values such as `text-[#fff]`, and literal CSS values such as `color: "#fff"`.
- If the existing vocabulary cannot express a required role, add a semantic `--color-*` token to `app/app.css`. Define it for the default theme, the explicit dark theme, and the system dark-mode fallback before using its Tailwind utility.
- Keep deliberately theme-independent colors exceptional. Use them only for externally defined brand colors or data-driven content, and add a short comment explaining why a semantic theme token is inappropriate.
- Check new or changed color interactions in both light and dark themes, including hover, active, focus, disabled, and selected states.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
