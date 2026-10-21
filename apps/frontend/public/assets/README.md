# Frontend Design Assets

This directory contains production UI assets for 开项 KaiPilot.

## Source And License

- `../branding/*`: current production logo and brand loader mirrored from `docs/branding/`.
- `brand/logo.svg`: legacy logo still referenced by LoginForm and OCR fixtures; retained. Unused logo-mark/app-icon were removed on 2026-10-08.
- Historical Kimi candidate images are retained only in `docs/v2-v3/source-package/`; redundant public copies were removed on 2026-10-08.
- `empty-states/*`: project-owned geometric SVG empty-state illustrations created for this codebase.
- `fonts/misans/*`: extracted from `misans-webfont@4.3.1`, Apache-2.0.
- `fonts/manrope/*`: extracted from `@fontsource/manrope@5.2.8`, OFL-1.1.

## Rules

- Use `public/branding/*` for all current product logo and page/AI loading states.
- Keep these assets available as stable public URLs from Next.js metadata and React components.
- Do not replace empty states with sketchy, hand-drawn, paper-texture, glow-heavy, or generated placeholder SVGs.
- Keep empty-state illustrations decorative: pair them with real headings, descriptions, and actions.
- Future work may replace the V1 font files with fuller CJK unicode-range subsets; keep the public paths stable when possible.
