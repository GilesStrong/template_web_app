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

import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
    it("merges class names", () => {
        expect(cn("px-2", "font-bold")).toBe("px-2 font-bold");
    });

    it("resolves Tailwind conflicts with the last value", () => {
        expect(cn("px-2", "px-4", { hidden: false, block: true })).toBe(
            "px-4 block",
        );
    });
});
