# Frontend Testing

This frontend uses **Vitest** + **React Testing Library** with a `jsdom` test environment.

## Run tests

From the `frontend/` directory:

```bash
bun run test --run
```

## Watch mode

```bash
bun run test
# or
bun run test:watch
```

## UI mode

```bash
bun run test:ui
```

## Adding new tests

- Name files with `*.test.ts` or `*.test.tsx`.
- Put tests next to the code they test when practical.
- For component tests, use `@testing-library/react` and `@testing-library/user-event`.
- Shared setup is in `vitest.setup.ts` (includes `jest-dom` matchers and lightweight browser API mocks).
