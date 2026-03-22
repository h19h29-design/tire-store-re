# CLI 4: Reproduction / Validation Support

## Goal

Act as the reproduction and verification lane for this wave.

## Scope

- Record the current dashboard failure state.
- Record the current Quick Sale clipping state.
- Record the current customer lookup display behavior.
- Keep notes and verification steps for the final merge.

## Allowed Files

- `parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation\*`

## Do Not Touch

- Product code by default

## Required Work

1. Reconfirm the real DB counts and import state if helpful.
2. Write reproducible notes for the three visible issues.
3. After other workers finish, re-run shared verification if practical.
4. Write the result into `RESULT.md`.

## Recommended Checks

- `npm run lint`
- `npm run build`
- `cargo test`
- DB inspection commands if needed
