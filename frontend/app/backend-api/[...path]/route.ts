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

const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL ?? "http://web:8000";
const ACCESS_TOKEN_COOKIE = "backend_access_token";

type RouteContext = {
    params: Promise<{ path: string[] }>;
};

type ProxyRequestInit = RequestInit & {
    duplex?: "half";
};

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

/**
 * Build a backend URL for proxied API requests.
 *
 * Args:
 *     pathSegments: The path segments captured by the catch-all route.
 *     search: Raw query string from the incoming request URL.
 *
 * Returns:
 *     The full backend URL for the target API route.
 */
function buildBackendUrl(pathSegments: string[], search: string): string {
    const normalizedBaseUrl = BACKEND_INTERNAL_URL.replace(/\/$/, "");
    const normalizedPath = pathSegments.join("/");
    return `${normalizedBaseUrl}/api/app/${normalizedPath}/${search}`;
}

/**
 * Filter backend response headers before returning to the client.
 *
 * Args:
 *     upstreamHeaders: Headers returned by the backend response.
 *
 * Returns:
 *     Headers safe to include in the proxied response.
 */
function filterResponseHeaders(upstreamHeaders: Headers): Headers {
    const filteredHeaders = new Headers();

    for (const [headerName, headerValue] of upstreamHeaders.entries()) {
        if (HOP_BY_HOP_RESPONSE_HEADERS.has(headerName.toLowerCase())) {
            continue;
        }

        filteredHeaders.set(headerName, headerValue);
    }

    return filteredHeaders;
}

/**
 * Forward an incoming request to the backend API with bearer token auth.
 *
 * Args:
 *     request: Incoming Next.js request.
 *     context: Route context containing catch-all path segments.
 *
 * Returns:
 *     A NextResponse relaying backend status, body, and content headers.
 */
async function forwardToBackend(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const { path } = await context.params;
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

    if (!accessToken) {
        return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    const backendUrl = buildBackendUrl(path, request.nextUrl.search);
    const requestHeaders = new Headers();
    requestHeaders.set("Authorization", `Bearer ${accessToken}`);

    const contentTypeHeader = request.headers.get("content-type");
    if (contentTypeHeader) {
        requestHeaders.set("Content-Type", contentTypeHeader);
    }

    const acceptHeader = request.headers.get("accept");
    if (acceptHeader) {
        requestHeaders.set("Accept", acceptHeader);
    }
    requestHeaders.set("X-Forwarded-Proto", "https");

    const requestInit: ProxyRequestInit = {
        method: request.method,
        headers: requestHeaders,
        cache: "no-store",
    };

    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
        requestInit.body = request.body;
        requestInit.duplex = "half";
    }

    let backendResponse: Response;
    try {
        backendResponse = await fetch(backendUrl, requestInit);
    } catch {
        return NextResponse.json({ detail: "Backend proxy request failed" }, { status: 502 });
    }

    return new NextResponse(backendResponse.body, {
        status: backendResponse.status,
        headers: filterResponseHeaders(backendResponse.headers),
    });
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    return forwardToBackend(request, context);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    return forwardToBackend(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    return forwardToBackend(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    return forwardToBackend(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    return forwardToBackend(request, context);
}
