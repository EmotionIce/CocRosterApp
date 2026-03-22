# Apps Script Parallel Modular Candidate

## Purpose
- `script/` remains the active, untouched monolithic Apps Script backend.
- `script_legacy/` is a frozen snapshot of `script/` taken at migration start.
- `script_modular/` is a parallel modular candidate derived from the current monolith state.
- This phase does **not** change deployment target or runtime cutover.

## Scope Of This Phase
- Preserve current public callable behavior and backend semantics.
- Preserve the current refresh-all consolidated architecture.
- Keep compatibility wrappers that still exist in current source.
- Keep non-server project files (for example `Admin.html`, `Index.html`) behavior-identical to legacy snapshot.

## Apps Script Constraints Used
- Apps Script server files share one global scope.
- No imports/exports, bundlers, transpilers, or module runtime shims were introduced.
- Top-level executable code is limited to constants, harmless caches, and function declarations.
- Function names/signatures were preserved so existing callable surface remains reachable.

## Architecture Notes
- The modular candidate reflects the **current** refresh-all architecture:
  - single active-roster job lock model,
  - shared refresh pipeline core,
  - refresh-all orchestration,
  - publish/auto-refresh flows that use the same active-roster lock model.
- Older removed per-roster public/admin and lock architectures were not reintroduced.

## Verification
Run from the `rosterApp/` folder:

```bash
python tools/verify_apps_script_migration.py
```

If you are in the parent directory, use:

```bash
python rosterApp/tools/verify_apps_script_migration.py
```

What the verifier now checks:
- live-source parity against `script/` (not only snapshot parity),
- snapshot drift (`script/` vs `script_legacy/`),
- required modular server-file set completeness,
- function/global/public-surface/admin-method parity,
- normalized function body equivalence,
- non-server source file parity (`Admin.html`, `Index.html`, etc.),
- top-level executable residue detection in modular files,
- runtime dependency hints (referenced Script Properties and trigger handler names).

See [DEPLOY_CHECKLIST.md](C:/Users/etien/Desktop/roster_mod%201/rosterApp/script_modular/DEPLOY_CHECKLIST.md) for cutover preflight and smoke-test steps.
