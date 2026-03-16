/*
Copyright 2026 Giles Strong

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { expect, test, type Page } from "@playwright/test";

import {
    captureGenerationRequest,
    mockAuth,
    mockBuildStatus,
    mockDeckBuildStatuses,
    mockDeckDetail,
    mockDeckListing,
    mockGenerationResponse,
    mockRemainingQuota,
    mockSetCodes,
    type DeckDetail,
    type DeckSummary,
} from "../helpers/network-mocks";

const DECK_ID = "deck-e2e-001";

const deckListing: DeckSummary[] = [
    {
        id: DECK_ID,
        name: "Izzet Spells",
        short_summary: "Spell-heavy tempo deck",
        set_codes: ["DMU", "WOE"],
        tags: ["Tempo"],
        date_updated: "2026-02-01T10:00:00.000Z",
        generation_status: "COMPLETED",
        generation_task_id: null,
    },
];

const deckDetail: DeckDetail = {
    id: DECK_ID,
    name: "Izzet Spells",
    short_summary: "Spell-heavy tempo deck",
    full_summary: "A red-blue spell deck for E2E validation.",
    set_codes: ["DMU", "WOE"],
    tags: ["Tempo"],
    date_updated: "2026-02-01T10:00:00.000Z",
    creation_status: "COMPLETED",
    cards: [
        {
            quantity: 2,
            role: "Primary Engine",
            importance: "Critical",
            card_info: {
                id: "card-1",
                name: "Lightning Strike",
                text: "Lightning Strike deals 3 damage to any target.",
                llm_summary: null,
                types: ["Instant"],
                subtypes: [],
                supertypes: [],
                set_codes: ["DMU"],
                rarity: "Common",
                converted_mana_cost: 2,
                mana_cost_colorless: 1,
                mana_cost_white: 0,
                mana_cost_blue: 0,
                mana_cost_black: 0,
                mana_cost_red: 1,
                mana_cost_green: 0,
                power: null,
                toughness: null,
                colors: ["R"],
                keywords: [],
                tags: ["Tempo"],
            },
            possible_replacements: [],
        },
    ],
};

const assertDeckIdAbsent = (payload: Record<string, unknown>) => {
    expect(Object.prototype.hasOwnProperty.call(payload, "deck_id")).toBe(false);
};

const assertDeckIdPresent = (payload: Record<string, unknown>, deckId: string) => {
    expect(Object.prototype.hasOwnProperty.call(payload, "deck_id")).toBe(true);
    expect(payload.deck_id).toBe(deckId);
};

const setupCommonApiMocks = async (page: Page) => {
    await mockDeckListing(page, deckListing);
    await mockDeckDetail(page, deckDetail);
    await mockDeckBuildStatuses(page, {
        all: [
            "PENDING",
            "IN_PROGRESS",
            "BUILDING_DECK",
            "CLASSIFYING_DECK_CARDS",
            "FINDING_REPLACEMENT_CARDS",
            "COMPLETED",
            "FAILED",
        ],
        pollable: [
            "PENDING",
            "IN_PROGRESS",
            "BUILDING_DECK",
            "CLASSIFYING_DECK_CARDS",
            "FINDING_REPLACEMENT_CARDS",
        ],
    });
    await mockSetCodes(page, ["DMU", "WOE"]);
    await mockRemainingQuota(page, 3);
};

test("redirects unauthenticated users to login for protected routes", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("main page -> generate -> submit excludes deck_id", async ({ page }) => {
    await mockAuth(page);
    await setupCommonApiMocks(page);
    await mockGenerationResponse(page, { task_id: "task-flow-1", deck_id: DECK_ID });
    await mockBuildStatus(page, "task-flow-1", DECK_ID, "COMPLETED");

    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Generate Deck" }).click();
    await expect(page).toHaveURL(/\/decks\/generate$/);

    await page.getByLabel("Prompt").fill("Build an Izzet spells deck for best-of-one ladder.");
    const generationRequest = captureGenerationRequest(page);
    await page.getByRole("button", { name: "Submit Generation Task" }).click();

    const payload = (await generationRequest).postDataJSON() as Record<string, unknown>;
    assertDeckIdAbsent(payload);

    await expect(page).toHaveURL(new RegExp(`/decks/${DECK_ID}$`), { timeout: 15_000 });
});

test("deck detail -> regenerate -> submit includes inspected deck_id", async ({ page }) => {
    await mockAuth(page);
    await setupCommonApiMocks(page);
    await mockGenerationResponse(page, { task_id: "task-flow-2", deck_id: DECK_ID });
    await mockBuildStatus(page, "task-flow-2", DECK_ID, "COMPLETED");

    await page.goto(`/decks/${DECK_ID}`);
    await expect(page.getByRole("heading", { name: "Deck Details" })).toBeVisible();

    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(page).toHaveURL(new RegExp(`/decks/generate\\?deckId=${DECK_ID}$`));

    await page.getByLabel("Prompt").fill("Regenerate with more instant-speed interaction.");
    const generationRequest = captureGenerationRequest(page);
    await page.getByRole("button", { name: "Submit Generation Task" }).click();

    const payload = (await generationRequest).postDataJSON() as Record<string, unknown>;
    assertDeckIdPresent(payload, DECK_ID);

    await expect(page).toHaveURL(new RegExp(`/decks/${DECK_ID}$`), { timeout: 15_000 });
});

test("deck detail -> regenerate -> dashboard -> generate -> submit excludes deck_id", async ({ page }) => {
    await mockAuth(page);
    await setupCommonApiMocks(page);
    await mockGenerationResponse(page, { task_id: "task-flow-3", deck_id: DECK_ID });
    await mockBuildStatus(page, "task-flow-3", DECK_ID, "COMPLETED");

    await page.goto(`/decks/${DECK_ID}`);
    await expect(page.getByRole("heading", { name: "Deck Details" })).toBeVisible();

    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(page).toHaveURL(new RegExp(`/decks/generate\\?deckId=${DECK_ID}$`));

    await page.getByRole("button", { name: "Back to Decks" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Generate Deck" }).click();
    await expect(page).toHaveURL(/\/decks\/generate$/);

    await page.getByLabel("Prompt").fill("Generate a new deck unrelated to the previous one.");
    const generationRequest = captureGenerationRequest(page);
    await page.getByRole("button", { name: "Submit Generation Task" }).click();

    const payload = (await generationRequest).postDataJSON() as Record<string, unknown>;
    assertDeckIdAbsent(payload);

    await expect(page).toHaveURL(new RegExp(`/decks/${DECK_ID}$`), { timeout: 15_000 });
});

test("generate redirects to deck detail with task and shows fine-grained status timeline", async ({ page }) => {
    await mockAuth(page);
    await mockDeckListing(page, deckListing);
    await mockSetCodes(page, ["DMU", "WOE"]);
    await mockRemainingQuota(page, 3);
    await mockDeckBuildStatuses(page, {
        all: [
            "PENDING",
            "IN_PROGRESS",
            "BUILDING_DECK",
            "CLASSIFYING_DECK_CARDS",
            "FINDING_REPLACEMENT_CARDS",
            "COMPLETED",
            "FAILED",
        ],
        pollable: [
            "PENDING",
            "IN_PROGRESS",
            "BUILDING_DECK",
            "CLASSIFYING_DECK_CARDS",
            "FINDING_REPLACEMENT_CARDS",
        ],
    });
    await mockGenerationResponse(page, { task_id: "task-flow-4", deck_id: DECK_ID });

    let allowCompletion = false;
    await page.route("**/api/app/cards/deck/*/full/", async (route) => {
        if (route.request().method() !== "GET") {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ...deckDetail,
                creation_status: allowCompletion ? "COMPLETED" : "BUILDING_DECK",
            }),
        });
    });
    await page.route("**/backend-api/cards/deck/*/full/", async (route) => {
        if (route.request().method() !== "GET") {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ...deckDetail,
                creation_status: allowCompletion ? "COMPLETED" : "BUILDING_DECK",
            }),
        });
    });

    await page.route("**/api/app/ai/deck/build_status/task-flow-4/", async (route) => {
        if (route.request().method() !== "GET") {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: allowCompletion ? "COMPLETED" : "BUILDING_DECK",
                deck_id: DECK_ID,
                prompt: "Build an Izzet spells deck with strong card selection.",
                n_cards_so_far: 54,
                n_searches_so_far: 13,
            }),
        });
    });
    await page.route("**/backend-api/ai/deck/build_status/task-flow-4/", async (route) => {
        if (route.request().method() !== "GET") {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: allowCompletion ? "COMPLETED" : "BUILDING_DECK",
                deck_id: DECK_ID,
                prompt: "Build an Izzet spells deck with strong card selection.",
                n_cards_so_far: 54,
                n_searches_so_far: 13,
            }),
        });
    });

    await page.goto("/decks/generate");
    await page.getByLabel("Prompt").fill("Build an Izzet spells deck with strong card selection.");
    await page.getByRole("button", { name: "Submit Generation Task" }).click();

    await expect(page).toHaveURL(new RegExp(`/decks/${DECK_ID}\\?taskId=task-flow-4$`), { timeout: 15_000 });
    await expect(page.getByText("Build Status")).toBeVisible();
    await expect(page.getByText("Prompt: Build an Izzet spells deck with strong card selection.")).toBeVisible();
    await expect(page.getByText(/BUILDING_DECK \(54 cards, 13 searches\)/)).toBeVisible();

    allowCompletion = true;
    await expect(page).toHaveURL(new RegExp(`/decks/${DECK_ID}$`), { timeout: 15_000 });
});
