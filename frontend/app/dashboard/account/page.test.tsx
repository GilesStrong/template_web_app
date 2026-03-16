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

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseSession,
  mockUseRouter,
  mockBackendFetch,
  mockSignOut,
  mockClearBackendTokens,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUseRouter: vi.fn(),
  mockBackendFetch: vi.fn(),
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
  backendFetch: mockBackendFetch,
  clearBackendTokens: mockClearBackendTokens,
}));

import AccountPage from "@/app/dashboard/account/page";

describe("AccountPage", () => {
  const push = vi.fn();
  const createObjectURL = vi.fn(() => "blob:download-url");
  const revokeObjectURL = vi.fn();
  const anchorClick = vi.fn();
  const originalCreateElement = document.createElement.bind(document);

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

    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      writable: true,
    });

    vi.spyOn(document, "createElement").mockImplementation((tagName: string): HTMLElement => {
      if (tagName.toLowerCase() === "a") {
        return {
          click: anchorClick,
          set href(_value: string) { },
          set download(_value: string) { },
        } as unknown as HTMLElement;
      }
      return originalCreateElement(tagName);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("downloads exported account data", async () => {
    const user = userEvent.setup();
    mockBackendFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ exported_at: "2026-03-01T00:00:00Z" }),
    } as unknown as Response);

    render(<AccountPage />);
    await user.click(screen.getByRole("button", { name: "Export My Data" }));

    expect(mockBackendFetch).toHaveBeenCalledWith(expect.anything(), "/api/app/user/me/export/");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Account data export downloaded.")).toBeInTheDocument();
  });

  it("deletes account when confirmed", async () => {
    const user = userEvent.setup();
    mockBackendFetch.mockImplementation(async (_session: unknown, url: string) => {
      if (url === "/api/app/user/me/delete-request/") {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            confirmation_token: "delete-token",
            expires_in_seconds: 900,
          }),
        } as unknown as Response;
      }
      if (url === "/api/app/user/me/") {
        return {
          ok: true,
          status: 204,
          json: vi.fn(),
        } as unknown as Response;
      }
      throw new Error(`Unexpected backend URL in test: ${url}`);
    });

    render(<AccountPage />);
    await user.click(screen.getByRole("button", { name: "Step 1: Request Deletion" }));
    await user.click(screen.getByRole("button", { name: "Delete My Account" }));

    expect(mockBackendFetch).toHaveBeenCalledWith(expect.anything(), "/api/app/user/me/delete-request/", {
      method: "POST",
    });
    expect(mockBackendFetch).toHaveBeenCalledWith(expect.anything(), "/api/app/user/me/", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirmation_token: "delete-token" }),
    });
    expect(mockClearBackendTokens).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });

  it("does not delete account before deletion is requested", async () => {
    render(<AccountPage />);
    expect(screen.getByRole("button", { name: "Delete My Account" })).toBeDisabled();

    expect(mockBackendFetch).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
