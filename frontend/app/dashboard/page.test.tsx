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
    mockGetAvatarUrlFromSession,
    mockSignOut,
    mockClearBackendTokens,
} = vi.hoisted(() => ({
    mockUseSession: vi.fn(),
    mockUseRouter: vi.fn(),
    mockGetAvatarUrlFromSession: vi.fn(),
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

vi.mock("@/lib/avatar", () => ({
    getAvatarUrlFromSession: mockGetAvatarUrlFromSession,
}));

import DashboardPage from "@/app/dashboard/page";

describe("DashboardPage", () => {
    const push = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        mockUseSession.mockReturnValue({
            data: {
                user: {
                    name: "Template User",
                    email: "builder@test.dev",
                },
            },
            status: "authenticated",
        });
        mockUseRouter.mockReturnValue({ push });
        mockGetAvatarUrlFromSession.mockReturnValue("https://images.test/avatar.png");
        mockClearBackendTokens.mockResolvedValue(undefined);
        mockSignOut.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
    });

    it("shows loading state while auth session is loading", () => {
        mockUseSession.mockReturnValue({
            data: null,
            status: "loading",
        });

        render(<DashboardPage />);

        expect(screen.queryByText("Template Dashboard")).not.toBeInTheDocument();
    });

    it("renders template content for authenticated users", async () => {
        render(<DashboardPage />);

        expect(await screen.findByText("Template Dashboard")).toBeInTheDocument();
        expect(screen.getByText("builder@test.dev")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Open Account" })).toBeInTheDocument();
    });

    it("navigates to account page from dashboard action", async () => {
        const user = userEvent.setup();

        render(<DashboardPage />);
        await user.click(screen.getByRole("button", { name: "Open Account" }));

        expect(push).toHaveBeenCalledWith("/dashboard/account");
    });

    it("clears backend tokens and signs out from user menu", async () => {
        const user = userEvent.setup();

        render(<DashboardPage />);

        const avatarButton = document.querySelector("button.relative.h-10.w-10.rounded-full");
        expect(avatarButton).toBeTruthy();
        await user.click(avatarButton as HTMLElement);
        await user.click(await screen.findByText("Sign out"));

        expect(mockClearBackendTokens).toHaveBeenCalledTimes(1);
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
    });
});
