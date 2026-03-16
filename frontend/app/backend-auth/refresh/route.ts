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

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL ?? "http://web:8000";
const SSL_WRONG_VERSION_NUMBER = "ERR_SSL_WRONG_VERSION_NUMBER";
const ACCESS_TOKEN_COOKIE = "backend_access_token";
const REFRESH_TOKEN_COOKIE = "backend_refresh_token";
const CSRF_COOKIE = "backend_csrf_token";

const getCookieSecurity = (request: NextRequest) => {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const isSecureRequest = request.nextUrl.protocol === "https:" || forwardedProto === "https";

    return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest,
    path: "/",
    };
};

/**
 * Checks if an unknown fetch error is the OpenSSL wrong-version TLS mismatch error.
 *
 * Args:
 *     error: Unknown thrown value from fetch.
 *
 * Returns:
 *     True when the error indicates https was attempted against a non-TLS endpoint.
 */
function isSslWrongVersionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const errorCause = error.cause;
    if (typeof errorCause === "object" && errorCause !== null && "code" in errorCause) {
        return (errorCause as { code?: unknown }).code === SSL_WRONG_VERSION_NUMBER;
    }

    return false;
}

/**
 * Converts an https backend URL to http, preserving host, port, and path.
 *
 * Args:
 *     url: Backend base URL.
 *
 * Returns:
 *     Equivalent http URL, or null when conversion is not applicable.
 */
function toHttpUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") {
            return null;
        }
        parsed.protocol = "http:";
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return null;
    }
}

/**
 * Performs fetch against backend and retries once over http when TLS protocol mismatch is detected.
 *
 * Args:
 *     path: Backend API path.
 *     requestInit: Fetch init object.
 *
 * Returns:
 *     The backend response.
 */
async function fetchBackend(path: string, requestInit: RequestInit): Promise<Response> {
    const primaryUrl = `${BACKEND_INTERNAL_URL}${path}`;

    try {
        return await fetch(primaryUrl, requestInit);
    } catch (error) {
        if (!isSslWrongVersionError(error)) {
            throw error;
        }

        const fallbackBaseUrl = toHttpUrl(BACKEND_INTERNAL_URL);
        if (!fallbackBaseUrl) {
            throw error;
        }

        return fetch(`${fallbackBaseUrl}${path}`, requestInit);
    }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    if (!refreshToken) {
        return NextResponse.json({ detail: "Missing refresh token" }, { status: 401 });
    }

    let response: Response;
    try {
        response = await fetchBackend("/api/app/token/refresh/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": request.headers.get("user-agent") ?? "",
                "X-Forwarded-For": request.headers.get("x-forwarded-for") ?? "",
                "X-Forwarded-Proto": "https",
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
            cache: "no-store",
        });
    } catch {
        return NextResponse.json({ detail: "Backend token refresh request failed" }, { status: 502 });
    }

    let data: { access_token?: string; refresh_token?: string; detail?: string };
    try {
        data = (await response.json()) as { access_token?: string; refresh_token?: string; detail?: string };
    } catch {
        data = {};
    }

    if (!response.ok || !data.access_token || !data.refresh_token) {
        return NextResponse.json(
            { detail: data.detail ?? "Failed to refresh backend tokens" },
            { status: response.status || 500 },
        );
    }

    const nextResponse = NextResponse.json({ ok: true }, { status: 200 });
    const security = getCookieSecurity(request);

    nextResponse.cookies.set(ACCESS_TOKEN_COOKIE, data.access_token, security);
    nextResponse.cookies.set(REFRESH_TOKEN_COOKIE, data.refresh_token, security);
    nextResponse.cookies.set(CSRF_COOKIE, randomUUID(), {
        ...security,
        httpOnly: false,
    });

    return nextResponse;
}
