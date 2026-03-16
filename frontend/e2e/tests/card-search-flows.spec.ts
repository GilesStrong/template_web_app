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
    captureCardSearchRequest,
    mockAuth,
    mockCardSearchResponse,
    mockCardTags,
    mockDeckDetail,
    mockDeckListing,
    mockSetCodes,
    type DeckDetail,
    type DeckSummary,
} from "../helpers/network-mocks";

const DECK_ID = "deck-search-e2e-001";

const deckListing: DeckSummary[] = [
    {
        id: DECK_ID,
        name: "Azorius Control",
        short_summary: "Control shell with board wipes and card draw",
        set_codes: ["ONE", "DMU"],
        tags: ["Control"],
        date_updated: "2026-02-15T10:00:00.000Z",
        generation_status: "COMPLETED",
        generation_task_id: null,
    },
];

const deckDetail: DeckDetail = {
    id: DECK_ID,
    name: "Azorius Control",
    short_summary: "Control shell with board wipes and card draw",
    full_summary: "Long summary for e2e tests.",
    set_codes: ["ONE", "DMU"],
    tags: ["Control"],
    date_updated: "2026-02-15T10:00:00.000Z",
    creation_status: "COMPLETED",
    cards: [
        {
            quantity: 2,
            role: "Interaction",
            importance: "Critical",
            card_info: {
                id: "card-deck-1",
                name: "Sunfall",
                text: "Exile all creatures.",
                llm_summary: null,
                types: ["Sorcery"],
                subtypes: [],
                supertypes: [],
                set_codes: ["ONE"],
                rarity: "Rare",
                converted_mana_cost: 5,
                mana_cost_colorless: 3,
                mana_cost_white: 2,
                mana_cost_blue: 0,
                mana_cost_black: 0,
                mana_cost_red: 0,
                mana_cost_green: 0,
                power: null,
                toughness: null,
                colors: ["W"],
                keywords: [],
                tags: ["Control", "BoardWipe"],
            },
            possible_replacements: [],
        },
        {
            quantity: 1,
            role: "Primary Engine",
            importance: "High Synergy",
            card_info: {
                id: "card-deck-2",
                name: "Memory Deluge",
                text: "Look at the top X cards...",
                llm_summary: null,
                types: ["Instant"],
                subtypes: [],
                supertypes: [],
                set_codes: ["DMU"],
                rarity: "Rare",
                converted_mana_cost: 4,
                mana_cost_colorless: 2,
                mana_cost_white: 0,
                mana_cost_blue: 2,
                mana_cost_black: 0,
                mana_cost_red: 0,
                mana_cost_green: 0,
                power: null,
                toughness: null,
                colors: ["U"],
                keywords: [],
                tags: ["Control"],
            },
            possible_replacements: [],
        },
    ],
};

const searchResults = [
    {
        relevance_score: 0.91,
        card_info: {
            id: "search-1",
            name: "Temporary Lockdown",
            text: "When Temporary Lockdown enters the battlefield...",
            llm_summary: null,
            types: ["Enchantment"],
            subtypes: [],
            supertypes: [],
            set_codes: ["DMU"],
            rarity: "Rare",
            converted_mana_cost: 3,
            mana_cost_colorless: 1,
            mana_cost_white: 2,
            mana_cost_blue: 0,
            mana_cost_black: 0,
            mana_cost_red: 0,
            mana_cost_green: 0,
            power: null,
            toughness: null,
            colors: ["W"],
            keywords: [],
            tags: ["Control"],
        },
    },
    {
        relevance_score: 0.67,
        card_info: {
            id: "search-2",
            name: "Get Lost",
            text: "Destroy target creature, enchantment, or planeswalker.",
            llm_summary: null,
            types: ["Instant"],
            subtypes: [],
            supertypes: [],
            set_codes: ["LCI"],
            rarity: "Rare",
            converted_mana_cost: 2,
            mana_cost_colorless: 1,
            mana_cost_white: 1,
            mana_cost_blue: 0,
            mana_cost_black: 0,
            mana_cost_red: 0,
            mana_cost_green: 0,
            power: null,
            toughness: null,
            colors: ["W"],
            keywords: [],
            tags: ["SpotRemoval", "Control"],
        },
    },
];

const setupSearchMocks = async (page: Page) => {
    await mockDeckListing(page, deckListing);
    await mockDeckDetail(page, deckDetail);
    await mockSetCodes(page, ["ONE", "DMU", "LCI"]);
    await mockCardTags(page, {
        Strategy: {
            Control: "Cards that are designed to manage the game state.",
            Ramp: "Cards that accelerate mana production.",
        },
        Interaction: {
            BoardWipe: "Effects that remove multiple permanents at once.",
            SpotRemoval: "Single-target answers to opposing threats.",
        },
    });
    await mockCardSearchResponse(page, searchResults);
};

test("dashboard -> search starts empty and sends prompt + filters, then renders results", async ({ page }) => {
    await mockAuth(page);
    await setupSearchMocks(page);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Search Cards" }).click();
    await expect(page).toHaveURL(/\/cards\/search$/);

    const queryField = page.getByLabel("Query");
    await expect(queryField).toHaveValue("");
    await expect(page.getByText("No filters active.")).toBeVisible();

    const prompt = "Find control cards that stabilise early against creature decks";
    await queryField.fill(prompt);
    await page.getByRole("button", { name: "White" }).click();
    await page.getByRole("button", { name: "DMU" }).click();

    const searchRequest = captureCardSearchRequest(page);
    await page.getByRole("button", { name: "Search Cards" }).click();

    const payload = (await searchRequest).postDataJSON() as {
        query: string;
        set_codes: string[];
        colors: string[];
        tags: string[];
    };

    expect(payload.query).toBe(prompt);
    expect(payload.colors).toEqual(["W"]);
    expect(payload.set_codes).toEqual(["DMU"]);
    expect(payload.tags).toEqual([]);

    await expect(page.getByText("2 cards found.")).toBeVisible();
    await expect(page.getByText("Temporary Lockdown")).toBeVisible();
    await expect(page.getByText("Get Lost")).toBeVisible();
});

test("deck detail -> search prefilled, then dashboard -> search resets to empty", async ({ page }) => {
    await mockAuth(page);
    await setupSearchMocks(page);

    await page.goto(`/decks/${DECK_ID}`);
    await expect(page.getByRole("heading", { name: "Deck Details" })).toBeVisible();

    await page.getByRole("button", { name: "Search Cards" }).click();
    await expect(page).toHaveURL(new RegExp(`/cards/search\\?deckId=${DECK_ID}$`));

    const queryField = page.getByLabel("Query");
    await expect(queryField).toHaveValue("Control shell with board wipes and card draw");
    await expect(page.getByText("6 filters selected.")).toBeVisible();

    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Search Cards" }).click();
    await expect(page).toHaveURL(/\/cards\/search$/);

    const freshQueryField = page.getByLabel("Query");
    await expect(freshQueryField).toHaveValue("");
    await expect(page.getByText("No filters active.")).toBeVisible();
});
