# Copyright 2026 Giles Strong
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

from django.test import TestCase

from appauth.api import router


class ApiRouterTests(TestCase):
    """Tests for appauth API router composition."""

    def test_registers_token_router_at_root_prefix(self):
        """
        GIVEN the appauth top-level router configuration
        WHEN inspecting mounted sub-routers
        THEN the token router is mounted at the empty prefix
        """
        prefixes = [prefix for prefix, _sub_router in router._routers]
        self.assertIn("", prefixes)
