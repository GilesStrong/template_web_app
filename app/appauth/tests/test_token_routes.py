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

from appuser.models import User
from django.test import TestCase
from django.utils import timezone
from ninja.errors import HttpError

from appauth.models.token import RefreshToken
from appauth.routes.token import exchange, refresh

_MODULE = "appauth.routes.token"


class ExchangeRouteTests(TestCase):
    """Tests for exchange route."""

    @patch(f"{_MODULE}.verify_google_token")
    def test_rejects_unverified_email(self, mock_verify):
        """
        GIVEN a Google token verification result with verified=False
        WHEN exchange is called
        THEN it raises HttpError 401
        """
        mock_verify.return_value = SimpleNamespace(verified=False, google_id="gid-1")
        with patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit:
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)

            request = SimpleNamespace(headers={}, META={})
            payload = SimpleNamespace(google_id_token="google-token")

            with self.assertRaises(HttpError) as ctx:
                exchange(request, payload)

        self.assertEqual(ctx.exception.status_code, 401)

    @patch(f"{_MODULE}.mint_access_token")
    @patch(f"{_MODULE}.RefreshToken")
    @patch(f"{_MODULE}.verify_google_token")
    @patch(f"{_MODULE}.APP_SETTINGS")
    def test_returns_tokens_for_verified_user(self, mock_settings, mock_verify, mock_refresh_token, mock_mint):
        """
        GIVEN a verified Google identity and allowed user
        WHEN exchange is called
        THEN it returns an access token and a newly minted refresh token
        """
        mock_settings.AUTH_EXCHANGE_PER_MINUTE = 20
        mock_verify.return_value = SimpleNamespace(verified=True, google_id="gid-ok")
        mock_mint.return_value = "access-token"
        mock_refresh_token.mint.return_value = (SimpleNamespace(token="hashed-refresh-token"), "refresh-token")

        with patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit:
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            request = SimpleNamespace(headers={"User-Agent": "pytest"}, META={"REMOTE_ADDR": "127.0.0.1"})
            payload = SimpleNamespace(google_id_token="google-token")

            result = exchange(request, payload)

        self.assertEqual(result.access_token, "access-token")
        self.assertEqual(result.refresh_token, "refresh-token")


class RefreshRouteTests(TestCase):
    """Tests for refresh route."""

    def test_rejects_missing_refresh_token(self):
        """
        GIVEN a refresh token value not present in storage
        WHEN refresh is called
        THEN it raises HttpError 401
        """
        with patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit:
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            request = SimpleNamespace(headers={}, META={})
            payload = SimpleNamespace(refresh_token="missing-token")

            with self.assertRaises(HttpError) as ctx:
                refresh(request, payload)

        self.assertEqual(ctx.exception.status_code, 401)

    def test_rejects_invalid_refresh_token(self):
        """
        GIVEN an existing refresh token that is expired or revoked
        WHEN refresh is called
        THEN it raises HttpError 401 and does not mint new tokens
        """
        user = User.objects.create(google_id="gid-refresh-invalid", verified=True)
        rt, raw_token = RefreshToken.mint(user, user_agent="ua", ip="127.0.0.1")
        rt.revoked_at = __import__("django.utils.timezone").utils.timezone.now()
        rt.save(update_fields=["revoked_at"])

        request = SimpleNamespace(headers={}, META={})
        payload = SimpleNamespace(refresh_token=raw_token)

        with (
            patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit,
            patch(f"{_MODULE}.mint_access_token") as mock_mint_access,
            patch(f"{_MODULE}.RefreshToken.mint") as mock_mint_refresh,
        ):
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            with self.assertRaises(HttpError) as ctx:
                refresh(request, payload)

        self.assertEqual(ctx.exception.status_code, 401)
        mock_mint_access.assert_not_called()
        mock_mint_refresh.assert_not_called()

    def test_rotates_refresh_and_returns_new_tokens(self):
        """
        GIVEN a valid refresh token
        WHEN refresh is called
        THEN it revokes the old token, mints a new refresh token, and returns new access and refresh tokens
        """
        user = User.objects.create(google_id="gid-refresh-ok", verified=True)
        old_rt, old_raw_token = RefreshToken.mint(user, user_agent="pytest", ip="127.0.0.1")

        request = SimpleNamespace(headers={"User-Agent": "pytest"}, META={"REMOTE_ADDR": "127.0.0.1"})
        payload = SimpleNamespace(refresh_token=old_raw_token)

        with (
            patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit,
            patch(f"{_MODULE}.mint_access_token") as mock_mint_access,
        ):
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            mock_mint_access.return_value = "new-access-token"

            result = refresh(request, payload)

        old_rt.refresh_from_db()
        new_rt = RefreshToken.from_raw_token(result.refresh_token)
        self.assertIsNotNone(old_rt.revoked_at)
        self.assertEqual(old_rt.revoked_reason, RefreshToken.RevocationReason.ROTATED)
        self.assertEqual(old_rt.replaced_by_id, new_rt.id)
        self.assertEqual(new_rt.parent_id, old_rt.id)
        self.assertEqual(new_rt.family_id, old_rt.family_id)
        self.assertEqual(result.access_token, "new-access-token")
        self.assertIsInstance(result.refresh_token, str)

    def test_reuse_of_rotated_token_revokes_token_family(self):
        """
        GIVEN a refresh token that has already been rotated once
        WHEN the old token is used again
        THEN the token family is revoked and refresh returns 401
        """
        user = User.objects.create(google_id="gid-refresh-reuse", verified=True)
        old_rt, old_raw_token = RefreshToken.mint(user, user_agent="pytest", ip="127.0.0.1")

        request = SimpleNamespace(headers={"User-Agent": "pytest"}, META={"REMOTE_ADDR": "127.0.0.1"})

        with (
            patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit,
            patch(f"{_MODULE}.mint_access_token") as mock_mint_access,
        ):
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            mock_mint_access.return_value = "new-access-token"

            first_result = refresh(request, SimpleNamespace(refresh_token=old_raw_token))

            with self.assertRaises(HttpError) as ctx:
                refresh(request, SimpleNamespace(refresh_token=old_raw_token))

        self.assertEqual(ctx.exception.status_code, 401)

        old_rt.refresh_from_db()
        new_rt = RefreshToken.from_raw_token(first_result.refresh_token)
        new_rt.refresh_from_db()

        self.assertIsNotNone(old_rt.revoked_at)
        self.assertEqual(old_rt.revoked_reason, RefreshToken.RevocationReason.ROTATED)
        self.assertIsNotNone(new_rt.revoked_at)
        self.assertEqual(new_rt.revoked_reason, RefreshToken.RevocationReason.REUSE_DETECTED[0])
        self.assertLessEqual(old_rt.revoked_at, timezone.now())

    def test_context_mismatch_revokes_refresh_token_family(self):
        """
        GIVEN a valid refresh token and a refresh request with different user-agent context
        WHEN refresh is called
        THEN it rejects with 401 and revokes the active token family with context_mismatch reason
        """
        user = User.objects.create(google_id="gid-refresh-context", verified=True)
        old_rt, old_raw_token = RefreshToken.mint(user, user_agent="ua-original", ip="203.0.113.10")

        request = SimpleNamespace(headers={"User-Agent": "ua-other"}, META={"REMOTE_ADDR": "203.0.113.10"})

        with (
            patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit,
            patch(f"{_MODULE}.mint_access_token") as mock_mint_access,
        ):
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)

            with self.assertRaises(HttpError) as ctx:
                refresh(request, SimpleNamespace(refresh_token=old_raw_token))

        self.assertEqual(ctx.exception.status_code, 401)
        mock_mint_access.assert_not_called()

        old_rt.refresh_from_db()
        self.assertIsNotNone(old_rt.revoked_at)
        self.assertEqual(old_rt.revoked_reason, "context_mismatch")

    def test_legacy_proxy_ip_token_is_allowed_once_and_rotates_to_client_ip(self):
        """
        GIVEN a legacy refresh token storing proxy REMOTE_ADDR instead of forwarded client IP
        WHEN refresh is called behind the same trusted proxy with a forwarded client IP
        THEN refresh succeeds and the rotated token stores the resolved client IP
        """
        user = User.objects.create(google_id="gid-refresh-legacy-proxy", verified=True)
        old_rt, old_raw_token = RefreshToken.mint(user, user_agent="pytest", ip="10.0.0.3")

        request = SimpleNamespace(
            headers={"User-Agent": "pytest", "X-Forwarded-For": "203.0.113.25"},
            META={"REMOTE_ADDR": "10.0.0.3"},
        )

        with (
            patch(f"{_MODULE}.check_auth_rate_limit") as mock_limit,
            patch(f"{_MODULE}.mint_access_token") as mock_mint_access,
            patch(f"{_MODULE}._extract_client_ip") as mock_extract_client_ip,
        ):
            mock_limit.return_value = SimpleNamespace(allowed=True, retry_after_seconds=0)
            mock_mint_access.return_value = "new-access-token"
            mock_extract_client_ip.return_value = "203.0.113.25"

            result = refresh(request, SimpleNamespace(refresh_token=old_raw_token))

        old_rt.refresh_from_db()
        new_rt = RefreshToken.from_raw_token(result.refresh_token)
        self.assertIsNotNone(old_rt.revoked_at)
        self.assertEqual(new_rt.ip, "203.0.113.25")
        self.assertEqual(result.access_token, "new-access-token")
