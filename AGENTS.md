# Jianmo application

This directory is the implementation workspace for a desktop-first, cross-platform Markdown editor. Preserve the v3 design in `design/`. The authoritative visual data is `design/design-tokens.json`; run `python design/build-design-system.py` and `npm run tokens` after changing it. Use semantic typography tokens and weights 400/500/600. Keep mobile touch targets at least 44px.

React and TypeScript live in `src/`; platform-independent document logic is in `src/core/`; browser/Tauri boundaries are in `src/platform/`; native commands are in `src-tauri/`. Keep user content out of logs. HTML preview must pass through DOMPurify. Native file paths must come from native dialogs, not arbitrary frontend arguments. Preserve draft recovery and external modification detection when editing save logic.

Run `npm run typecheck`, `npm test`, and `npm run build`. Desktop changes additionally require `cargo test --manifest-path src-tauri/Cargo.toml` and a native smoke test when Rust and platform prerequisites are available. Report unrun checks explicitly. Browser DOM tests do not establish visual correctness.

Project-local design skills are under `design/design-skills/`. Generated output and dependencies belong in ignored directories. Do not alter existing design source when only implementing app behavior.
