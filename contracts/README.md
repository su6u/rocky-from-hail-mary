# Contracts

Shared artifacts generated from TypeScript packages for Python training and other non-TS consumers.

**Do not edit by hand.** Run from repo root:

```bash
pnpm sync-contracts
```

| File | Source |
|------|--------|
| `domain.json` | `@rocky/domain` — emotions, gestures, metadata tag |
| `prompts/rocky-system.txt` | `@rocky/prompt` — `SYSTEM_PROMPT` |

Regenerate after changing domain enums or prompt text in `packages/`.
