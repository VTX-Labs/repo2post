<!-- Keep pull requests focused and as small as practical. -->

## Summary

<!-- What does this change, and why? Link the related issue, e.g. Closes #123. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / chore
- [ ] Documentation
- [ ] Breaking change

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (tests added/updated for the change)
- [ ] `pnpm build` succeeds
- [ ] README / `--help` updated if behavior changed
- [ ] AI calls remain injectable so tests run with no network or API key
- [ ] Secret/generated/binary files stay excluded from the captured diff (no regression in `diff.ts`)
- [ ] `--no-diff` still produces a valid messages-only prompt
