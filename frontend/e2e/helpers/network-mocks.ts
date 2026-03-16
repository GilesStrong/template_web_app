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

import type { Page, Request, Route } from "@playwright/test";
import { encode } from "next-auth/jwt";

type DeckSummary = {
    id: string;
    name: string;
    short_summary: string | null;
    set_codes: string[];
    tags?: string[];
    date_updated: string;
    generation_status: string | null;
    generation_task_id: string | null;
};

type DeckCardResponse = {
    id: string;
    name: string;
    text: string;
    llm_summary: string | null;
    types: string[];
    subtypes: string[];
    supertypes: string[];
    set_codes: string[];
    rarity: string;
    converted_mana_cost: number;
    mana_cost_colorless: number;
    mana_cost_white: number;
    mana_cost_blue: number;
    mana_cost_black: number;
    mana_cost_red: number;
    mana_cost_green: number;
    power: string | null;
    toughness: string | null;
    colors: string[];
    keywords: string[];
    tags?: string[];
};

type SearchCardResponse = {
    id: string;
    name: string;
    text: string;
    llm_summary: string | null;
    types: string[];
    subtypes: string[];
    supertypes: string[];
    set_codes: string[];
    rarity: string;
    converted_mana_cost: number;
    mana_cost_colorless: number;
    mana_cost_white: number;
    mana_cost_blue: number;
    mana_cost_black: number;
    mana_cost_red: number;
    mana_cost_green: number;
    power: string | null;
    toughness: string | null;
    colors: string[];
    keywords: string[];
    tags: string[];
};

type SearchCardResult = {
    card_info: SearchCardResponse;
    relevance_score: number;
};

type DeckDetail = {
    id: string;
    name: string;
    short_summary: string | null;
    full_summary: string | null;
    set_codes: string[];
    tags?: string[];
    date_updated: string;
    creation_status: string | null;
    cards: Array<{
        quantity: number;
        role?: string | null;
        importance?: string | null;
        card_info: DeckCardResponse;
        possible_replacements?: DeckCardResponse[];
    }>;
};

type GenerationResponse = {
    task_id: string;
    deck_id?: string;
};

type DeckBuildStatusesResponse = {
    all: string[];
    pollable: string[];
};

type BuildStatusResponse = {
    status: string;
    deck_id: string;
    prompt?: string | null;
    n_cards_so_far?: number | null;
    n_searches_so_far?: number | null;
    n_replacements_so_far?: number | null;
    n_replacements_total?: number | null;
};

type DeleteRequestResponse = {
    confirmation_token: string;
    expires_in_seconds: number;
};

const DEFAULT_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";
const E2E_NEXTAUTH_SECRET =
    process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-please-change-in-real-env-32chars";
const BACKEND_APP_PREFIX = "/api/app/";
const BACKEND_PROXY_PREFIX = "/backend-api/";

const E2E_USER = {
    name: "E2E Deck User",
    email: "e2e-user@myapp.dev",
    image: "https://example.test/avatar.png",
    googleAuthToken: "e2e.google.token",
};

/**
 * Convert backend app paths to their proxied frontend route equivalent.
 */
const toProxyPath = (pathname: string): string => {
    if (!pathname.startsWith(BACKEND_APP_PREFIX)) {
        return pathname;
    }

    return `${BACKEND_PROXY_PREFIX}${pathname.slice(BACKEND_APP_PREFIX.length)}`;
};

/**
 * Check whether a URL path matches either direct backend app paths or proxied frontend paths.
 */
const isPath = (urlString: string, pathname: string): boolean => {
    const url = new URL(urlString);
    return url.pathname === pathname || url.pathname === toProxyPath(pathname);
};

const isDeckDetailPath = (urlString: string): boolean => {
    const url = new URL(urlString);
    return /^\/(api\/app|backend-api)\/cards\/deck\/[^/]+\/full\/$/.test(url.pathname);
};

const createAuthCookieValue = async (): Promise<string> =>
    encode({
        token: {
            name: E2E_USER.name,
            email: E2E_USER.email,
            picture: E2E_USER.image,
            googleAuthToken: E2E_USER.googleAuthToken,
        },
        secret: E2E_NEXTAUTH_SECRET,
        maxAge: 60 * 60,
    });

export const mockAuth = async (page: Page): Promise<void> => {
    const baseUrl = new URL(DEFAULT_BASE_URL);
    const sessionToken = await createAuthCookieValue();
    let isSignedOut = false;

    await page.context().addCookies([
        {
            name: "next-auth.session-token",
            value: sessionToken,
            domain: baseUrl.hostname,
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
        },
    ]);

    await page.route("**/api/auth/session", async (route) => {
        if (isSignedOut) {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(null),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                user: E2E_USER,
                expires: "2099-01-01T00:00:00.000Z",
            }),
        });
    });

    await page.route("**/api/auth/csrf", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ csrfToken: "e2e-csrf-token" }),
        });
    });

    await page.route("**/api/auth/signout", async (route) => {
        isSignedOut = true;

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: {
                "set-cookie": "next-auth.session-token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
            },
            body: JSON.stringify({ url: `${DEFAULT_BASE_URL}/login` }),
        });
    });

    await page.route("**/backend-auth/exchange", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ok: true,
            }),
        });
    });

    await page.route("**/backend-auth/refresh", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ok: true,
            }),
        });
    });

    await page.route("**/backend-auth/clear", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true }),
        });
    });
};

export const mockDeckListing = async (page: Page, decks: DeckSummary[]): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET" || !isPath(route.request().url(), "/api/app/cards/deck/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(decks),
        });
    };

    await page.route("**/api/app/cards/deck/", handler);
    await page.route("**/backend-api/cards/deck/", handler);
};

export const mockDeckDetail = async (page: Page, deck: DeckDetail): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET") {
            await route.continue();
            return;
        }

        if (!isDeckDetailPath(route.request().url())) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(deck),
        });
    };

    await page.route("**/api/app/cards/deck/*/full/", handler);
    await page.route("**/backend-api/cards/deck/*/full/", handler);
};

export const captureGenerationRequest = (page: Page): Promise<Request> =>
    page.waitForRequest(
        (request) =>
            request.method() === "POST" && isPath(request.url(), "/api/app/ai/deck/"),
        { timeout: 10_000 }
    );

export const mockGenerationResponse = async (
    page: Page,
    response: GenerationResponse
): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "POST" || !isPath(route.request().url(), "/api/app/ai/deck/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(response),
        });
    };

    await page.route("**/api/app/ai/deck/", handler);
    await page.route("**/backend-api/ai/deck/", handler);
};

export const mockSetCodes = async (page: Page, setCodes: string[]): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET" || !isPath(route.request().url(), "/api/app/cards/card/set_codes/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ set_codes: setCodes }),
        });
    };

    await page.route("**/api/app/cards/card/set_codes/", handler);
    await page.route("**/backend-api/cards/card/set_codes/", handler);
};

export const mockCardTags = async (
    page: Page,
    tags: Record<string, Record<string, string>>
): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET" || !isPath(route.request().url(), "/api/app/cards/card/tags/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ tags }),
        });
    };

    await page.route("**/api/app/cards/card/tags/", handler);
    await page.route("**/backend-api/cards/card/tags/", handler);
};

export const captureCardSearchRequest = (page: Page): Promise<Request> =>
    page.waitForRequest(
        (request) =>
            request.method() === "POST" && isPath(request.url(), "/api/app/search/search/"),
        { timeout: 10_000 }
    );

export const mockCardSearchResponse = async (
    page: Page,
    cards: SearchCardResult[]
): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "POST" || !isPath(route.request().url(), "/api/app/search/search/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ cards }),
        });
    };

    await page.route("**/api/app/search/search/", handler);
    await page.route("**/backend-api/search/search/", handler);
};

export const mockRemainingQuota = async (page: Page, remaining: number): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET" || !isPath(route.request().url(), "/api/app/ai/deck/remaining_quota/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ remaining }),
        });
    };

    await page.route("**/api/app/ai/deck/remaining_quota/", handler);
    await page.route("**/backend-api/ai/deck/remaining_quota/", handler);
};

export const mockBuildStatus = async (
    page: Page,
    taskId: string,
    deckId: string,
    status: "COMPLETED" | "FAILED" | "BUILDING_DECK" | "FINDING_REPLACEMENT_CARDS" = "COMPLETED",
    details?: Omit<BuildStatusResponse, "status" | "deck_id">
): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET") {
            await route.continue();
            return;
        }

        const requestUrl = new URL(route.request().url());
        const appPath = `/api/app/ai/deck/build_status/${taskId}/`;
        const proxyPath = toProxyPath(appPath);
        if (requestUrl.pathname !== appPath && requestUrl.pathname !== proxyPath) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ status, deck_id: deckId, ...details }),
        });
    };

    await page.route("**/api/app/ai/deck/build_status/*/", handler);
    await page.route("**/backend-api/ai/deck/build_status/*/", handler);
};

export const mockDeckBuildStatuses = async (
    page: Page,
    response: DeckBuildStatusesResponse
): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET" || !isPath(route.request().url(), "/api/app/ai/deck/statuses/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(response),
        });
    };

    await page.route("**/api/app/ai/deck/statuses/", handler);
    await page.route("**/backend-api/ai/deck/statuses/", handler);
};

export const mockAccountExport = async (page: Page, payload: Record<string, unknown>): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "GET" || !isPath(route.request().url(), "/api/app/user/me/export/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(payload),
        });
    };

    await page.route("**/api/app/user/me/export/", handler);
    await page.route("**/backend-api/user/me/export/", handler);
};

export const mockDeleteRequest = async (
    page: Page,
    response: DeleteRequestResponse
): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "POST" || !isPath(route.request().url(), "/api/app/user/me/delete-request/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(response),
        });
    };

    await page.route("**/api/app/user/me/delete-request/", handler);
    await page.route("**/backend-api/user/me/delete-request/", handler);
};

export const captureDeleteConfirmationRequest = (page: Page): Promise<Request> =>
    page.waitForRequest(
        (request) =>
            request.method() === "DELETE" && isPath(request.url(), "/api/app/user/me/"),
        { timeout: 10_000 }
    );

export const mockDeleteConfirm = async (page: Page): Promise<void> => {
    const handler = async (route: Route) => {
        if (route.request().method() !== "DELETE" || !isPath(route.request().url(), "/api/app/user/me/")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 204,
            contentType: "application/json",
            body: "",
        });
    };

    await page.route("**/api/app/user/me/", handler);
    await page.route("**/backend-api/user/me/", handler);
};

export type { DeckDetail, DeckSummary };
