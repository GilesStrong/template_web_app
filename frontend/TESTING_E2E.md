# Frontend E2E Testing (Playwright)

This project keeps Playwright configured, but does not ship domain-specific E2E specs.

## Current state

- `playwright.config.ts` is ready to run tests from `frontend/e2e/tests`.
- Existing product-specific E2E specs were removed to keep this repo template-focused.

## Add new E2E tests

1. Create a spec file under `frontend/e2e/tests/`, for example:

```ts
import { expect, test } from "@playwright/test";

test("dashboard loads", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Template Dashboard")).toBeVisible();
});
```

2. If your test needs backend stubs, add helpers under `frontend/e2e/helpers/` and register `page.route(...)` handlers in the spec.

3. Run E2E tests:

```bash
cd frontend
bun run e2e
```

Useful variants:

```bash
bun run e2e:ui
bun run e2e:debug
```

## Environment

- `E2E_BASE_URL` is optional and defaults to `http://localhost:3001`.
- Playwright starts the app automatically using `bun run dev` from `playwright.config.ts`.
