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

type MockResponse = {
    type: "next" | "redirect";
    url?: string;
    headers: {
        set: ReturnType<typeof vi.fn>;
    };
};

const { mockGetToken, mockRedirect, mockNext } = vi.hoisted(() => ({
    mockGetToken: vi.fn(),
    mockRedirect: vi.fn((url: URL): MockResponse => ({
        type: "redirect",
        url: url.toString(),
        headers: {
            set: vi.fn(),
        },
    })),
    mockNext: vi.fn((): MockResponse => ({
        type: "next",
        headers: {
            set: vi.fn(),
        },
    })),
}));

vi.mock("next-auth/jwt", () => ({
    getToken: mockGetToken,
}));

vi.mock("next/server", () => ({
    NextResponse: {
        redirect: mockRedirect,
        next: mockNext,
    },
}));

import { config, proxy } from "@/proxy";

describe("proxy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXTAUTH_SECRET = "test-secret";
        vi.stubGlobal("crypto", {
            randomUUID: vi.fn(() => "123e4567-e89b-12d3-a456-426614174000"),
        });
        vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "utf-8").toString("base64"));
    });

    it("redirects unauthenticated users from protected routes", async () => {
        mockGetToken.mockResolvedValue(null);

        const response = await proxy({
            nextUrl: { pathname: "/dashboard" },
            url: "https://app.test/dashboard",
        } as never);

        expect(mockRedirect).toHaveBeenCalledTimes(1);
        expect(response.type).toBe("redirect");
        expect(response.url).toBe("https://app.test/login");
    });

    it("redirects authenticated users away from login", async () => {
        mockGetToken.mockResolvedValue({ sub: "user-id" });

        const response = await proxy({
            nextUrl: { pathname: "/login" },
            url: "https://app.test/login",
        } as never);

        expect(mockRedirect).toHaveBeenCalledTimes(1);
        expect(response.type).toBe("redirect");
        expect(response.url).toBe("https://app.test/dashboard");
    });

    it("continues when access is allowed", async () => {
        mockGetToken.mockResolvedValue({ sub: "user-id" });

        const response = await proxy({
            nextUrl: { pathname: "/dashboard" },
            headers: new Headers(),
            url: "https://app.test/dashboard",
        } as never);

        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(mockNext).toHaveBeenCalledWith({
            request: {
                headers: expect.any(Headers),
            },
        });
        const nextCall = mockNext.mock.calls[0]?.[0];
        const requestHeaders = nextCall.request.headers as Headers;

        expect(requestHeaders.get("x-nonce")).toBeTruthy();
        expect(requestHeaders.get("Content-Security-Policy")).toContain("'strict-dynamic'");
        expect(response.type).toBe("next");
        expect(response.headers.set).toHaveBeenCalledWith(
            "Content-Security-Policy",
            expect.stringContaining("script-src 'self' 'nonce-"),
        );
        expect(response.headers.set).toHaveBeenCalledWith(
            "Content-Security-Policy",
            expect.stringContaining("'strict-dynamic'"),
        );
        expect(response.headers.set).toHaveBeenCalledWith(
            "Content-Security-Policy",
            expect.stringContaining("https://lh3.googleusercontent.com"),
        );
    });

    it("skips CSP and auth checks on API routes", async () => {
        const response = await proxy({
            nextUrl: { pathname: "/api/app/token/exchange/" },
            url: "https://app.test/api/app/token/exchange/",
        } as never);

        expect(mockGetToken).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(response.type).toBe("next");
    });

    it("exports expected route matcher config", () => {
        expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
    });
});
