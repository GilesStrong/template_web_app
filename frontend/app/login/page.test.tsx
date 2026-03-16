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

const { mockUseSearchParams, mockSignIn } = vi.hoisted(() => ({
    mockUseSearchParams: vi.fn(),
    mockSignIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useSearchParams: mockUseSearchParams,
}));

vi.mock("next-auth/react", () => ({
    signIn: mockSignIn,
}));

import { LoginPageClient } from "@/app/login/login-page-client";

describe("LoginPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it("shows auth error message when present in query params", () => {
        mockUseSearchParams.mockReturnValue({
            get: (key: string) => (key === "error" ? "OAuthAccountNotLinked" : null),
        });

        render(<LoginPageClient />);

        expect(screen.getByText("OAuthAccountNotLinked")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    });

    it("shows access denied screen without sign in button", () => {
        mockUseSearchParams.mockReturnValue({
            get: (key: string) => (key === "error" ? "AccessDenied" : null),
        });

        render(<LoginPageClient />);

        expect(screen.getByText("Access denied")).toBeInTheDocument();
        expect(screen.getByText("Your Google account is not authorized for this app.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    });

    it("shows access denied screen for normalized error variants", () => {
        mockUseSearchParams.mockReturnValue({
            get: (key: string) => (key === "error" ? "access_denied" : null),
        });

        render(<LoginPageClient />);

        expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
    });

    it("calls signIn with Google provider when button is clicked", async () => {
        const user = userEvent.setup();
        mockUseSearchParams.mockReturnValue({ get: () => null });

        render(<LoginPageClient />);
        await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

        expect(mockSignIn).toHaveBeenCalledWith(
            "google",
            { callbackUrl: "/dashboard" },
            { prompt: "select_account" },
        );
    });
});
