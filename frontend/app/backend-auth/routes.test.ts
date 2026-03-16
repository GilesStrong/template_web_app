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

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetToken = vi.fn();

vi.mock("next-auth/jwt", () => ({
    getToken: mockGetToken,
}));

const makeExchangeRequest = (body: string, headers?: HeadersInit): NextRequest =>
    new NextRequest("http://localhost/backend-auth/exchange", {
        method: "POST",
        headers,
        body,
    });

const makeSecureExchangeRequest = (body: string, headers?: HeadersInit): NextRequest =>
    new NextRequest("https://myapp.strong-tech.org/backend-auth/exchange", {
        method: "POST",
        headers,
        body,
    });

const makeRefreshRequest = (cookieValue?: string, headers?: HeadersInit): NextRequest => {
    const combinedHeaders = new Headers(headers);
    if (cookieValue) {
        combinedHeaders.set("cookie", `backend_refresh_token=${cookieValue}`);
    }

    return new NextRequest("http://localhost/backend-auth/refresh", {
        method: "POST",
        headers: combinedHeaders,
    });
};

const makeSecureRefreshRequest = (cookieValue?: string, headers?: HeadersInit): NextRequest => {
    const combinedHeaders = new Headers(headers);
    if (cookieValue) {
        combinedHeaders.set("cookie", `backend_refresh_token=${cookieValue}`);
    }

    return new NextRequest("https://myapp.strong-tech.org/backend-auth/refresh", {
        method: "POST",
        headers: combinedHeaders,
    });
};

const makeClearRequest = (url = "http://localhost/backend-auth/clear", headers?: HeadersInit): NextRequest =>
    new NextRequest(url, {
        method: "POST",
        headers,
    });

describe("backend-auth route handlers", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        mockGetToken.mockReset();
        process.env.BACKEND_INTERNAL_URL = "http://backend.internal";
        process.env.NEXTAUTH_SECRET = "test-nextauth-secret";
    });

    it("exchange sets access, refresh, and csrf cookies when backend exchange succeeds", async () => {
        mockGetToken.mockResolvedValue({ googleAuthToken: "google-token-from-jwt" });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ access_token: "access-123", refresh_token: "refresh-123" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const route = await import("@/app/backend-auth/exchange/route");
        const response = await route.POST(
            makeExchangeRequest("", {
                "user-agent": "vitest",
                "x-forwarded-for": "203.0.113.10",
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://backend.internal/api/app/token/exchange/",
            expect.objectContaining({
                method: "POST",
                cache: "no-store",
                headers: expect.objectContaining({
                    "X-Forwarded-Proto": "https",
                }),
                body: JSON.stringify({ google_id_token: "google-token-from-jwt" }),
            }),
        );
        expect(response.cookies.get("backend_access_token")?.value).toBe("access-123");
        expect(response.cookies.get("backend_refresh_token")?.value).toBe("refresh-123");

        const csrfCookie = response.cookies.get("backend_csrf_token");
        expect(csrfCookie?.value).toBeTruthy();
        expect(csrfCookie?.httpOnly).toBe(false);
    });

    it("exchange sets secure cookies on https requests", async () => {
        mockGetToken.mockResolvedValue({ googleAuthToken: "google-token-from-jwt" });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ access_token: "access-123", refresh_token: "refresh-123" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const route = await import("@/app/backend-auth/exchange/route");
        const response = await route.POST(makeSecureExchangeRequest(""));

        expect(response.cookies.get("backend_access_token")?.secure).toBe(true);
        expect(response.cookies.get("backend_refresh_token")?.secure).toBe(true);
        expect(response.cookies.get("backend_csrf_token")?.secure).toBe(true);
    });

    it("exchange returns backend error detail when token exchange fails", async () => {
        mockGetToken.mockResolvedValue({ googleAuthToken: "google-token-from-jwt" });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ detail: "User not allowed" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const route = await import("@/app/backend-auth/exchange/route");
        const response = await route.POST(makeExchangeRequest(""));

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ detail: "User not allowed" });
    });

    it("exchange retries with http when https backend URL hits TLS wrong-version error", async () => {
        process.env.BACKEND_INTERNAL_URL = "https://backend.internal";
        mockGetToken.mockResolvedValue({ googleAuthToken: "google-token-from-jwt" });
        const tlsMismatchError = new TypeError("fetch failed", {
            cause: { code: "ERR_SSL_WRONG_VERSION_NUMBER" },
        });
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockRejectedValueOnce(tlsMismatchError)
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ access_token: "access-123", refresh_token: "refresh-123" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );

        const route = await import("@/app/backend-auth/exchange/route");
        const response = await route.POST(makeExchangeRequest(""));

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "https://backend.internal/api/app/token/exchange/",
            expect.any(Object),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "http://backend.internal/api/app/token/exchange/",
            expect.any(Object),
        );
    });

    it("exchange returns 502 when backend fetch throws non-retryable error", async () => {
        mockGetToken.mockResolvedValue({ googleAuthToken: "google-token-from-jwt" });
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

        const route = await import("@/app/backend-auth/exchange/route");
        const response = await route.POST(makeExchangeRequest(""));

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({ detail: "Backend token exchange request failed" });
    });

    it("exchange returns 401 when no Google ID token is available", async () => {
        mockGetToken.mockResolvedValue(null);

        const route = await import("@/app/backend-auth/exchange/route");
        const response = await route.POST(makeExchangeRequest(""));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ detail: "Missing Google ID token" });
    });

    it("refresh returns 401 when refresh cookie is missing", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");

        const route = await import("@/app/backend-auth/refresh/route");
        const response = await route.POST(makeRefreshRequest());

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ detail: "Missing refresh token" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refresh rotates access, refresh, and csrf cookies on success", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const route = await import("@/app/backend-auth/refresh/route");
        const response = await route.POST(
            makeRefreshRequest("refresh-cookie-value", {
                "user-agent": "vitest",
                "x-forwarded-for": "203.0.113.10",
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://backend.internal/api/app/token/refresh/",
            expect.objectContaining({
                headers: expect.objectContaining({
                    "X-Forwarded-Proto": "https",
                }),
            }),
        );
        expect(response.cookies.get("backend_access_token")?.value).toBe("new-access");
        expect(response.cookies.get("backend_refresh_token")?.value).toBe("new-refresh");

        const csrfCookie = response.cookies.get("backend_csrf_token");
        expect(csrfCookie?.value).toBeTruthy();
        expect(csrfCookie?.httpOnly).toBe(false);
    });

    it("refresh sets secure cookies on https requests", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        const route = await import("@/app/backend-auth/refresh/route");
        const response = await route.POST(makeSecureRefreshRequest("refresh-cookie-value"));

        expect(response.cookies.get("backend_access_token")?.secure).toBe(true);
        expect(response.cookies.get("backend_refresh_token")?.secure).toBe(true);
        expect(response.cookies.get("backend_csrf_token")?.secure).toBe(true);
    });

    it("refresh retries with http when https backend URL hits TLS wrong-version error", async () => {
        process.env.BACKEND_INTERNAL_URL = "https://backend.internal";
        const tlsMismatchError = new TypeError("fetch failed", {
            cause: { code: "ERR_SSL_WRONG_VERSION_NUMBER" },
        });
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockRejectedValueOnce(tlsMismatchError)
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );

        const route = await import("@/app/backend-auth/refresh/route");
        const response = await route.POST(makeRefreshRequest("refresh-cookie-value"));

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "https://backend.internal/api/app/token/refresh/",
            expect.any(Object),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "http://backend.internal/api/app/token/refresh/",
            expect.any(Object),
        );
    });

    it("refresh returns 502 when backend fetch throws non-retryable error", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

        const route = await import("@/app/backend-auth/refresh/route");
        const response = await route.POST(makeRefreshRequest("refresh-cookie-value"));

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({ detail: "Backend token refresh request failed" });
    });

    it("clear expires all backend auth cookies", async () => {
        const route = await import("@/app/backend-auth/clear/route");
        const response = await route.POST(makeClearRequest());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });

        const access = response.cookies.get("backend_access_token");
        const refresh = response.cookies.get("backend_refresh_token");
        const csrf = response.cookies.get("backend_csrf_token");

        expect(access?.value).toBe("");
        expect(refresh?.value).toBe("");
        expect(csrf?.value).toBe("");
        expect(access?.maxAge).toBe(0);
        expect(refresh?.maxAge).toBe(0);
        expect(csrf?.maxAge).toBe(0);
        expect(csrf?.httpOnly).toBe(false);
    });

    it("clear sets secure cookie attributes on https requests", async () => {
        const route = await import("@/app/backend-auth/clear/route");
        const response = await route.POST(makeClearRequest("https://myapp.strong-tech.org/backend-auth/clear"));

        expect(response.cookies.get("backend_access_token")?.secure).toBe(true);
        expect(response.cookies.get("backend_refresh_token")?.secure).toBe(true);
        expect(response.cookies.get("backend_csrf_token")?.secure).toBe(true);
    });
});
