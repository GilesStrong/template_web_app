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

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    mockUseSession,
    mockUseRouter,
    mockSignOut,
    mockClearBackendTokens,
} = vi.hoisted(() => ({
    mockUseSession: vi.fn(),
    mockUseRouter: vi.fn(),
    mockSignOut: vi.fn(),
    mockClearBackendTokens: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
}));

vi.mock("next/navigation", () => ({
    useRouter: mockUseRouter,
}));

vi.mock("@/lib/backend-auth", () => ({
    clearBackendTokens: mockClearBackendTokens,
}));

import AccountPage from "@/app/dashboard/account/page";

describe("AccountPage", () => {
    const push = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        mockUseSession.mockReturnValue({
            data: {
                user: {
                    email: "builder@test.dev",
                },
            },
            status: "authenticated",
        });
        mockUseRouter.mockReturnValue({ push });
        mockClearBackendTokens.mockResolvedValue(undefined);
        mockSignOut.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
    });

    it("renders account information from session", async () => {
        render(<AccountPage />);

        expect(await screen.findByText("Account")).toBeInTheDocument();
        expect(screen.getByText("Signed in as builder@test.dev")).toBeInTheDocument();
    });

    it("navigates back to dashboard", async () => {
        const user = userEvent.setup();

        render(<AccountPage />);
        await user.click(screen.getByRole("button", { name: "Back to Dashboard" }));

        expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("clears backend tokens and signs out", async () => {
        const user = userEvent.setup();

        render(<AccountPage />);
        await user.click(screen.getByRole("button", { name: "Sign out" }));

        expect(mockClearBackendTokens).toHaveBeenCalledTimes(1);
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
    });
});
