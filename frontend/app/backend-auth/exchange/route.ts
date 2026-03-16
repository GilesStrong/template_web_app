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
import { getToken } from "next-auth/jwt";

const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL ?? "http://web:8000";
const SSL_WRONG_VERSION_NUMBER = "ERR_SSL_WRONG_VERSION_NUMBER";
const ACCESS_TOKEN_COOKIE = "backend_access_token";
const REFRESH_TOKEN_COOKIE = "backend_refresh_token";
const CSRF_COOKIE = "backend_csrf_token";

/**
 * Builds cookie security attributes from environment and request proxy metadata.
 *
 * Args:
 *     request: Incoming Next.js request.
 *
 * Returns:
 *     Cookie options that keep auth cookies Secure in production.
 */
const getCookieSecurity = (request: NextRequest): {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: "/";
} => {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const isSecureRequest = request.nextUrl.protocol === "https:" || forwardedProto === "https";
    const isProduction = process.env.NODE_ENV === "production";

    return {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: isProduction || isSecureRequest,
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
    let googleIdToken: string | null = null;

    try {
        const rawBody = await request.text();
        if (rawBody.trim().length > 0) {
            const parsedBody = JSON.parse(rawBody) as { google_id_token?: unknown };
            if (typeof parsedBody.google_id_token === "string" && parsedBody.google_id_token.length > 0) {
                googleIdToken = parsedBody.google_id_token;
            }
        }
    } catch {
        return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
    }

    if (!googleIdToken) {
        const sessionToken = await getToken({
            req: request,
            secret: process.env.NEXTAUTH_SECRET,
        });
        if (typeof sessionToken?.googleAuthToken === "string" && sessionToken.googleAuthToken.length > 0) {
            googleIdToken = sessionToken.googleAuthToken;
        }
    }

    if (!googleIdToken) {
        return NextResponse.json({ detail: "Missing Google ID token" }, { status: 401 });
    }

    let response: Response;
    try {
        response = await fetchBackend("/api/app/token/exchange/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": request.headers.get("user-agent") ?? "",
                "X-Forwarded-For": request.headers.get("x-forwarded-for") ?? "",
                "X-Forwarded-Proto": "https",
            },
            body: JSON.stringify({ google_id_token: googleIdToken }),
            cache: "no-store",
        });
    } catch {
        return NextResponse.json({ detail: "Backend token exchange request failed" }, { status: 502 });
    }

    let data: { access_token?: string; refresh_token?: string; detail?: string };
    try {
        data = (await response.json()) as { access_token?: string; refresh_token?: string; detail?: string };
    } catch {
        data = {};
    }

    if (!response.ok || !data.access_token || !data.refresh_token) {
        return NextResponse.json(
            { detail: data.detail ?? "Please login to continue" },
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
