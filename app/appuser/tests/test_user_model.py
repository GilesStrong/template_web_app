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

from django.db import IntegrityError
from django.test import TestCase

from appuser.models import User


class UserModelTests(TestCase):
    """Tests for appuser.models.User."""

    def test_creates_user_with_expected_defaults(self):
        """
        GIVEN a new user created with only google_id
        WHEN the user is persisted
        THEN verified defaults to False and warning_count defaults to 0
        """
        user = User.objects.create(google_id="gid-defaults")

        self.assertFalse(user.verified)
        self.assertEqual(user.warning_count, 0)
        self.assertIsNotNone(user.id)

    def test_google_id_must_be_unique(self):
        """
        GIVEN an existing user with a specific google_id
        WHEN another user is created with the same google_id
        THEN the database raises IntegrityError for uniqueness violation
        """
        User.objects.create(google_id="gid-unique")

        with self.assertRaises(IntegrityError):
            User.objects.create(google_id="gid-unique")

    def test_warning_count_can_be_updated(self):
        """
        GIVEN a persisted user record
        WHEN warning_count is incremented and saved
        THEN the updated warning_count value is persisted
        """
        user = User.objects.create(google_id="gid-warning")
        user.warning_count += 2
        user.save(update_fields=["warning_count"])
        user.refresh_from_db()

        self.assertEqual(user.warning_count, 2)
