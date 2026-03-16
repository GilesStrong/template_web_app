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

import { beforeAll, describe, expect, it } from "vitest";

const toBase64Url = (value: string): string =>
    btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const makeGoogleIdToken = (claims: Record<string, unknown>): string => {
    const header = toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = toBase64Url(JSON.stringify(claims));
    return `${header}.${payload}.sig`;
};

let authOptions: (typeof import("@/lib/auth"))["authOptions"];

beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "test-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "test-google-client-secret";
    ({ authOptions } = await import("@/lib/auth"));
});

describe("authOptions callbacks", () => {
    it("signIn callback allows only configured Google emails", async () => {
        process.env.GOOGLE_ENFORCE_ALLOWED_EMAILS = "true";
        process.env.GOOGLE_ALLOWED_EMAILS = "allowed@test.dev, other@test.dev";

        const allowedResult = await authOptions.callbacks?.signIn?.({
            account: { provider: "google" },
            user: { email: "allowed@test.dev" },
            profile: undefined,
        } as never);

        const deniedResult = await authOptions.callbacks?.signIn?.({
            account: { provider: "google" },
            user: { email: "denied@test.dev" },
            profile: undefined,
        } as never);

        expect(allowedResult).toBe(true);
        expect(deniedResult).toBe(false);
    });

    it("signIn callback normalizes allowlist and user email", async () => {
        process.env.GOOGLE_ENFORCE_ALLOWED_EMAILS = "true";
        process.env.GOOGLE_ALLOWED_EMAILS = "  TeSt.User@Test.Dev  ";

        const result = await authOptions.callbacks?.signIn?.({
            account: { provider: "google" },
            user: { email: "test.user@test.dev" },
            profile: undefined,
        } as never);

        expect(result).toBe(true);
    });

    it("signIn callback denies when allowlist is unset and enforcement is enabled", async () => {
        process.env.GOOGLE_ENFORCE_ALLOWED_EMAILS = "true";
        delete process.env.GOOGLE_ALLOWED_EMAILS;

        const result = await authOptions.callbacks?.signIn?.({
            account: { provider: "google" },
            user: { email: "anyone@test.dev" },
            profile: undefined,
        } as never);

        expect(result).toBe(false);
    });

    it("signIn callback allows all Google users when enforcement is disabled", async () => {
        process.env.GOOGLE_ENFORCE_ALLOWED_EMAILS = "false";
        delete process.env.GOOGLE_ALLOWED_EMAILS;

        const result = await authOptions.callbacks?.signIn?.({
            account: { provider: "google" },
            user: { email: "anyone@test.dev" },
            profile: undefined,
        } as never);

        expect(result).toBe(true);
    });

    it("redirect callback handles relative and same-origin URLs", async () => {
        expect(
            await authOptions.callbacks?.redirect?.({
                url: "/dashboard",
                baseUrl: "https://app.test",
            }),
        ).toBe("https://app.test/dashboard");

        expect(
            await authOptions.callbacks?.redirect?.({
                url: "https://app.test/decks",
                baseUrl: "https://app.test",
            }),
        ).toBe("https://app.test/decks");

        expect(
            await authOptions.callbacks?.redirect?.({
                url: "https://evil.test/phish",
                baseUrl: "https://app.test",
            }),
        ).toBe("https://app.test");
    });

    it("jwt callback stores Google token and decoded claims", async () => {
        const idToken = makeGoogleIdToken({
            picture: "https://images.test/pic.png",
            name: "Jace Beleren",
            email: "jace@test.dev",
        });

        const token = await authOptions.callbacks?.jwt?.({
            token: {},
            account: { id_token: idToken },
            profile: undefined,
        } as never);

        expect(token?.googleAuthToken).toBe(idToken);
        expect(token?.picture).toBe("https://images.test/pic.png");
        expect(token?.name).toBe("Jace Beleren");
        expect(token?.email).toBe("jace@test.dev");
    });

    it("session callback projects non-sensitive token values onto session.user", async () => {
        const session = await authOptions.callbacks?.session?.({
            session: { user: {} },
            token: {
                googleAuthToken: "token-123",
                picture: "https://images.test/user.png",
                name: "Teferi",
                email: "teferi@test.dev",
            },
        } as never);

        expect((session?.user as Record<string, unknown>)?.googleAuthToken).toBeUndefined();
        expect(session?.user?.image).toBe("https://images.test/user.png");
        expect(session?.user?.name).toBe("Teferi");
        expect(session?.user?.email).toBe("teferi@test.dev");
    });
});
