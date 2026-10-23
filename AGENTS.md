# Agent guidelines

- Use Node 24 and pnpm.
- Astro integration: `src/index.ts`; editor: `src/editor/`; local API: `src/routes/`.
- Read related code and tests first. Keep changes small and preserve unrelated work.
- Reuse existing components and styles. Do not add dependencies without approval.
- Preserve explicit Save, unsaved-change guards, and input validation.
- Run `pnpm test`, `pnpm typecheck`, and `pnpm build` for code changes. Report any checks not run.
- Keep temporary files in gitignored `_temp/`. Never include credentials or private notes.
- For agent-assisted work, commit only when the user explicitly says `yolo`. Push, publish, deploy, and history changes require separate explicit approval.
