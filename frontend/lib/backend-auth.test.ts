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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { backendFetch, clearBackendTokens, ensureBackendTokens } from "@/lib/backend-auth";

const mockResponse = ({
    ok,
    status,
    json,
}: {
    ok: boolean;
    status: number;
    json?: unknown;
}): Response =>
({
    ok,
    status,
    json: vi.fn().mockResolvedValue(json ?? {}),
} as unknown as Response);

describe("backend-auth", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("ensureBackendTokens exchanges backend tokens via secure cookie route", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            mockResponse({
                ok: true,
                status: 200,
                json: { ok: true },
            }),
        );

        await ensureBackendTokens({
            user: { email: "user@test.dev" },
        } as never);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "/backend-auth/exchange",
            expect.objectContaining({
                method: "POST",
                credentials: "same-origin",
            }),
        );
    });

    it("ensureBackendTokens throws when session is missing", async () => {
        await expect(ensureBackendTokens(null)).rejects.toThrow("Missing authenticated session");
    });

    it("backendFetch refreshes cookie-backed token after 401 and retries", async () => {
        let protectedRequestCount = 0;
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === "/api/protected") {
                protectedRequestCount += 1;
                if (protectedRequestCount === 1) {
                    return mockResponse({ ok: false, status: 401 });
                }
                if (protectedRequestCount === 2) {
                    return mockResponse({ ok: true, status: 200 });
                }
            }

            if (url === "/backend-auth/refresh") {
                return mockResponse({ ok: true, status: 200, json: { ok: true } });
            }

            if (url === "/backend-auth/exchange") {
                return mockResponse({ ok: true, status: 200, json: { ok: true } });
            }

            return mockResponse({ ok: false, status: 500 });
        });

        const response = await backendFetch(
            { user: { email: "user@test.dev" } } as never,
            "/api/protected",
        );

        expect(response.status).toBe(200);
        expect(protectedRequestCount).toBe(2);
        expect(fetchMock).toHaveBeenCalledWith(
            "/backend-auth/refresh",
            expect.objectContaining({ method: "POST", credentials: "same-origin" }),
        );
        expect(fetchMock).not.toHaveBeenCalledWith(
            "/backend-auth/exchange",
            expect.anything(),
        );
    });

    it("backendFetch treats redirect responses as auth-like failures and retries", async () => {
        let protectedRequestCount = 0;
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url === "/api/protected") {
                protectedRequestCount += 1;
                if (protectedRequestCount === 1) {
                    return mockResponse({ ok: false, status: 302 });
                }

                return mockResponse({ ok: true, status: 200 });
            }

            if (url === "/backend-auth/refresh") {
                return mockResponse({ ok: true, status: 200, json: { ok: true } });
            }

            return mockResponse({ ok: false, status: 500 });
        });

        const response = await backendFetch(
            { user: { email: "user@test.dev" } } as never,
            "/api/protected",
        );

        expect(response.status).toBe(200);
        expect(protectedRequestCount).toBe(2);
        expect(fetchMock).toHaveBeenCalledWith(
            "/backend-auth/refresh",
            expect.objectContaining({ method: "POST", credentials: "same-origin" }),
        );
    });

    it("backendFetch retries after initial fetch throws by refreshing backend tokens", async () => {
        let protectedRequestCount = 0;
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url === "/api/protected") {
                protectedRequestCount += 1;
                if (protectedRequestCount === 1) {
                    throw new TypeError("fetch failed");
                }

                return mockResponse({ ok: true, status: 200 });
            }

            if (url === "/backend-auth/refresh") {
                return mockResponse({ ok: true, status: 200, json: { ok: true } });
            }

            return mockResponse({ ok: false, status: 500 });
        });

        const response = await backendFetch(
            { user: { email: "user@test.dev" } } as never,
            "/api/protected",
        );

        expect(response.status).toBe(200);
        expect(protectedRequestCount).toBe(2);
        expect(fetchMock).toHaveBeenCalledWith(
            "/backend-auth/refresh",
            expect.objectContaining({ method: "POST", credentials: "same-origin" }),
        );
    });

    it("clearBackendTokens clears cookie-backed tokens via API route", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            mockResponse({ ok: true, status: 200, json: { ok: true } }),
        );

        await clearBackendTokens();

        expect(fetchMock).toHaveBeenCalledWith(
            "/backend-auth/clear",
            expect.objectContaining({
                method: "POST",
                credentials: "same-origin",
                keepalive: true,
            }),
        );
    });

    it("backendFetch sends X-Backend-CSRF for unsafe requests when csrf cookie is present", async () => {
        document.cookie = "backend_csrf_token=test-csrf-token";

        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
            const headers = new Headers(init?.headers);
            if (String(_input) === "/api/protected") {
                expect(headers.get("X-Backend-CSRF")).toBe("test-csrf-token");
            }

            return mockResponse({ ok: true, status: 200, json: { ok: true } });
        });

        const response = await backendFetch(null, "/api/protected", {
            method: "POST",
            body: JSON.stringify({ prompt: "test" }),
            headers: { "Content-Type": "application/json" },
        });

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("backendFetch rewrites app API paths to backend proxy paths", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            mockResponse({ ok: true, status: 200, json: { ok: true } }),
        );

        const response = await backendFetch(
            { user: { email: "user@test.dev" } } as never,
            "/api/app/cards/deck/",
        );

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith(
            "/backend-api/cards/deck/",
            expect.objectContaining({
                method: "GET",
                credentials: "same-origin",
            }),
        );
    });
});
