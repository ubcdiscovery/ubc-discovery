# Web Frontend Guidelines

These instructions apply to all files under `web/` and supplement the repository-level `AGENTS.md`.

## Admin Dashboard Direction

- The admin dashboard should be easy to use, easy to read, and easy to maintain. Prefer simplicity and minimal implementation code over visual polish.
- When introducing a new component, try to base it on the closest shadcn/ui component and adapt it to this app's semantic tokens and conventions. Prefer source-owned shared primitives under `app/components/ui/` over hand-rolled route markup, while keeping admin route composition, auth gating, API adapters, query behavior, and Event Listing domain logic explicit in the web app.
- Avoid introducing a full CRUD/admin framework until repeated admin resources and workflows justify its complexity.
- Event Listing editing must support replacing the event image through the protected presigned-upload flow. Keep image upload independent from metadata Save and show clear upload, success, and failure states.

## Navigation

- Rely on browser Back and Forward navigation for history-aware movement wherever possible. Do not add custom back buttons or back links when the browser can provide that navigation; keep links for intentional destination navigation or required workflow actions.

## Design system

- The design system (colors, type, components, voice, and the rules for using color tokens in code) lives in the hq repository at [`hq/design-system/README.md`](../../hq/design-system/README.md) ([GitHub](https://github.com/ubcdiscovery/hq/blob/main/design-system/README.md)). Read it before changing anything visual.
- `app/app.css` implements it. Design changes land in hq first.

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
