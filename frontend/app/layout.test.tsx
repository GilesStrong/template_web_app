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

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockProviders } = vi.hoisted(() => ({
    mockProviders: vi.fn(),
}));

vi.mock("next/font/google", () => ({
    Inter: vi.fn(() => ({ className: "mock-inter" })),
}));

vi.mock("@/app/providers", () => ({
    Providers: ({ children }: { children: React.ReactNode }) => {
        mockProviders();
        return <div data-testid="providers">{children}</div>;
    },
}));

vi.mock("@/app/favicon.png", () => ({
    default: {
        src: "/favicon.png",
    },
}));

import RootLayout, { metadata } from "@/app/layout";

describe("RootLayout", () => {
    it("wraps children with Providers and sets html lang/body class", () => {
        const { container } = render(
            <RootLayout>
                <main>Dashboard Content</main>
            </RootLayout>,
        );

        expect(screen.getByTestId("providers")).toBeInTheDocument();
        expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
        expect(mockProviders).toHaveBeenCalledTimes(1);

        const html = container.querySelector("html");
        const body = container.querySelector("body");

        expect(html).toHaveAttribute("lang", "en");
        expect(body).toHaveClass("mock-inter");
    });

    it("exports expected metadata", () => {
        expect(metadata.title).toBe("Deep MTG");
        expect(metadata.description).toBe("AI-powered Magic: The Gathering deck builder");
        expect(metadata.icons).toEqual({
            icon: [{ url: "/favicon.png", type: "image/png" }],
            shortcut: [{ url: "/favicon.png", type: "image/png" }],
        });
    });
});
