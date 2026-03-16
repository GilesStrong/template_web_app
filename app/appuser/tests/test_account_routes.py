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

from types import SimpleNamespace
from unittest.mock import patch

from appauth.models.token import RefreshToken
from django.test import TestCase
from ninja.errors import HttpError

from appuser.models import User
from appuser.routes.account import (
    EXPORT_ACCOUNT_LIMIT_PER_HOUR,
    EXPORT_ACCOUNT_WINDOW_SECONDS,
    delete_account,
    export_account_data,
    request_delete_account,
)

_MODULE = 'appuser.routes.account'


class AccountRoutesTests(TestCase):
    """Tests for account data export and deletion routes."""

    def test_export_account_data_returns_profile_data(self):
        """
        GIVEN an authenticated user
        WHEN export_account_data is called
        THEN the payload includes user profile data
        """
        user = User.objects.create(google_id="gid-export", verified=True)
        _token, _raw_token = RefreshToken.mint(user, user_agent="pytest", ip="127.0.0.1")

        with patch(f'{_MODULE}.check_auth_rate_limit') as mock_limit:
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            result = export_account_data(SimpleNamespace(auth=user, headers={}, META={}))

        self.assertEqual(result.user.id, user.id)
        self.assertEqual(result.user.google_id, "gid-export")

    def test_export_account_data_rate_limit_rejected(self):
        """
        GIVEN an authenticated user and a blocked export rate-limit result
        WHEN export_account_data is called
        THEN it raises HttpError 429
        """
        user = User.objects.create(google_id='gid-export-limited', verified=True)

        with patch(f'{_MODULE}.check_auth_rate_limit') as mock_limit:
            mock_limit.return_value = SimpleNamespace(allowed=False, retry_after_seconds=3600)

            with self.assertRaises(HttpError) as context:
                export_account_data(SimpleNamespace(auth=user, headers={}, META={}))

        self.assertEqual(context.exception.status_code, 429)

    def test_export_account_data_rate_limit_called_with_hourly_window(self):
        """
        GIVEN an authenticated user and an allowed export rate-limit result
        WHEN export_account_data is called
        THEN it checks rate limiting with a 1-per-hour configuration
        """
        user = User.objects.create(google_id='gid-export-window', verified=True)
        request = SimpleNamespace(auth=user, headers={}, META={})

        with patch(f'{_MODULE}.check_auth_rate_limit') as mock_limit:
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            export_account_data(request)

        mock_limit.assert_called_once_with(
            request,
            action='account-export',
            limit=EXPORT_ACCOUNT_LIMIT_PER_HOUR,
            window_seconds=EXPORT_ACCOUNT_WINDOW_SECONDS,
        )

    def test_delete_account_removes_user_and_related_records(self):
        """
        GIVEN an authenticated user with refresh tokens
        WHEN delete_account is called with a valid confirmation token
        THEN the user and related records are removed
        """
        user = User.objects.create(google_id="gid-delete", verified=True)
        _token, _raw_token = RefreshToken.mint(user, user_agent="pytest", ip="127.0.0.1")
        confirmation = request_delete_account(SimpleNamespace(auth=user))

        delete_account(SimpleNamespace(auth=user), SimpleNamespace(confirmation_token=confirmation.confirmation_token))

        self.assertFalse(User.objects.filter(id=user.id).exists())
        self.assertFalse(RefreshToken.objects.filter(user_id=user.id).exists())

    def test_delete_account_rejects_invalid_confirmation_token(self):
        """
        GIVEN an authenticated user
        WHEN delete_account is called with an invalid confirmation token
        THEN the route raises HttpError and does not delete the account
        """
        user = User.objects.create(google_id="gid-invalid-token", verified=True)

        with self.assertRaises(HttpError) as context:
            delete_account(SimpleNamespace(auth=user), SimpleNamespace(confirmation_token="invalid-token"))

        self.assertEqual(context.exception.status_code, 400)
        self.assertTrue(User.objects.filter(id=user.id).exists())
