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

import type { Session } from "next-auth";

const BACKEND_AUTH_EXCHANGE_PATH = "/backend-auth/exchange";
const BACKEND_AUTH_REFRESH_PATH = "/backend-auth/refresh";
const BACKEND_AUTH_CLEAR_PATH = "/backend-auth/clear";
const BACKEND_PROXY_PREFIX = "/backend-api/";
const BACKEND_APP_PREFIX = "/api/app/";
const BACKEND_CSRF_COOKIE_NAME = "backend_csrf_token";

const parseBackendErrorMessage = async (response: Response, fallbackMessage: string): Promise<string> => {
    try {
        const data = (await response.json()) as {
            detail?: string;
            message?: string;
            error?: string;
        };
        return data.detail ?? data.message ?? data.error ?? fallbackMessage;
    } catch {
        return fallbackMessage;
    }
};

const exchangeGoogleToken = async (): Promise<void> => {
    const response = await fetch(BACKEND_AUTH_EXCHANGE_PATH, {
        method: "POST",
        credentials: "same-origin",
    });

    if (!response.ok) {
        throw new Error(await parseBackendErrorMessage(response, "Please login to continue"));
    }
};

const refreshBackendTokens = async (): Promise<void> => {
    const response = await fetch(BACKEND_AUTH_REFRESH_PATH, {
        method: "POST",
        credentials: "same-origin",
    });

    if (!response.ok) {
        throw new Error(await parseBackendErrorMessage(response, "Failed to refresh backend tokens"));
    }
};

const getCookieValue = (name: string): string | null => {
    if (typeof document === "undefined") {
        return null;
    }

    const encodedName = encodeURIComponent(name);
    const target = `${encodedName}=`;
    const parts = document.cookie.split(";");
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith(target)) {
            return decodeURIComponent(trimmed.slice(target.length));
        }
    }
    return null;
};

const isUnsafeMethod = (method: string): boolean => {
    return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
};

const isAuthLikeFailure = (response: Response): boolean => {
    if (response.status === 401) {
        return true;
    }

    return response.status >= 300 && response.status < 400;
};

const toProxyInput = (input: RequestInfo | URL): RequestInfo | URL => {
    if (typeof input === "string") {
        if (!input.startsWith(BACKEND_APP_PREFIX)) {
            return input;
        }

        return `${BACKEND_PROXY_PREFIX}${input.slice(BACKEND_APP_PREFIX.length)}`;
    }

    if (input instanceof URL && input.pathname.startsWith(BACKEND_APP_PREFIX)) {
        const proxiedPath = `${BACKEND_PROXY_PREFIX}${input.pathname.slice(BACKEND_APP_PREFIX.length)}`;
        return `${proxiedPath}${input.search}`;
    }

    return input;
};

export const ensureBackendTokens = async (session: Session | null): Promise<void> => {
    if (!session?.user) {
        throw new Error("Missing authenticated session");
    }

    await exchangeGoogleToken();
};

export const clearBackendTokens = async (): Promise<void> => {
    const response = await fetch(BACKEND_AUTH_CLEAR_PATH, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
    });

    if (!response.ok) {
        throw new Error(await parseBackendErrorMessage(response, "Failed to clear backend tokens"));
    }
};

export const backendFetch = async (
    session: Session | null,
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Response> => {
    const proxiedInput = toProxyInput(input);

    const runRequest = async (): Promise<Response> => {
        const method = (init?.method ?? "GET").toUpperCase();
        const headers = new Headers(init?.headers);
        if (isUnsafeMethod(method)) {
            const csrfToken = getCookieValue(BACKEND_CSRF_COOKIE_NAME);
            if (csrfToken) {
                headers.set("X-Backend-CSRF", csrfToken);
            }
        }

        return fetch(proxiedInput, {
            ...init,
            method,
            headers,
            credentials: "same-origin",
        });
    };

    let response: Response;
    try {
        response = await runRequest();
    } catch {
        try {
            await refreshBackendTokens();
            return await runRequest();
        } catch {
            try {
                await clearBackendTokens();
            } catch {
                // no-op
            }
        }

        if (!session?.user) {
            throw new Error("Backend request failed before authentication");
        }

        await exchangeGoogleToken();
        return runRequest();
    }

    if (!isAuthLikeFailure(response)) {
        return response;
    }

    try {
        await refreshBackendTokens();
        response = await runRequest();
        if (!isAuthLikeFailure(response)) {
            return response;
        }
    } catch {
        try {
            await clearBackendTokens();
        } catch {
            // no-op
        }
    }

    if (!session?.user) {
        return response;
    }

    await exchangeGoogleToken();
    return runRequest();
};
