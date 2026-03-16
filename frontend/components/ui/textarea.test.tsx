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
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
    it("renders placeholder and accepts typed value", async () => {
        const user = userEvent.setup();

        render(<Textarea placeholder="Describe your deck idea" />);

        const textarea = screen.getByPlaceholderText("Describe your deck idea");
        await user.type(textarea, "Aggro deck with haste creatures");

        expect(textarea).toHaveValue("Aggro deck with haste creatures");
    });
});
