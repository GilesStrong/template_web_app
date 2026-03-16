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

import { describe, expect, it, vi } from "vitest";

const { mockNextAuth, mockAuthOptions, mockHandler } = vi.hoisted(() => ({
    mockNextAuth: vi.fn(),
    mockAuthOptions: { providers: ["mock-provider"] },
    mockHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
    authOptions: mockAuthOptions,
}));

vi.mock("next-auth", () => ({
    default: mockNextAuth,
}));

const loadRouteModule = async () => {
    vi.resetModules();
    mockNextAuth.mockReturnValue(mockHandler);
    return import("@/app/api/auth/[...nextauth]/route");
};

describe("auth route handler exports", () => {
    it("builds handler with authOptions", async () => {
        await loadRouteModule();

        expect(mockNextAuth).toHaveBeenCalledTimes(1);
        expect(mockNextAuth).toHaveBeenCalledWith(mockAuthOptions);
    });

    it("exports GET and POST as the same NextAuth handler", async () => {
        const routeModule = await loadRouteModule();

        expect(routeModule.GET).toBe(mockHandler);
        expect(routeModule.POST).toBe(mockHandler);
    });
});
