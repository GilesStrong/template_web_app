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

from datetime import timedelta
from unittest.mock import patch

from appuser.models import User
from django.test import TestCase
from django.utils import timezone

from appauth.models.token import RefreshToken

_MODULE = "appauth.models.token"


class RefreshTokenModelTests(TestCase):
    """Tests for RefreshToken model behavior."""

    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.secrets.token_urlsafe")
    def test_mint_persists_token_with_expected_fields(self, mock_token_urlsafe, mock_settings):
        """
        GIVEN a user and refresh token settings
        WHEN RefreshToken.mint is called
        THEN it creates a refresh token record with bounded user_agent and expected token value
        """
        mock_settings.REFRESH_TOKEN_TTL_SECONDS = 3600
        mock_token_urlsafe.return_value = "refresh-token-value"
        user = User.objects.create(google_id="gid-model-1", verified=True)

        token, raw_token = RefreshToken.mint(user, user_agent="x" * 1200, ip="127.0.0.1")

        self.assertEqual(raw_token, "refresh-token-value")
        self.assertEqual(token.token, RefreshToken.hash_token("refresh-token-value"))
        self.assertEqual(token.user_id, user.id)
        self.assertEqual(token.user_agent, "x" * 1000)
        self.assertEqual(token.ip, "127.0.0.1")
        self.assertGreater(token.expires_at, timezone.now())

    def test_is_valid_false_when_revoked(self):
        """
        GIVEN a refresh token with revoked_at set
        WHEN is_valid is called
        THEN it returns False
        """
        user = User.objects.create(google_id="gid-model-2", verified=True)
        token, _raw_token = RefreshToken.mint(user)
        token.revoked_at = timezone.now()
        token.save(update_fields=["revoked_at"])

        self.assertFalse(token.is_valid())

    def test_is_valid_false_when_expired(self):
        """
        GIVEN a refresh token with expires_at in the past
        WHEN is_valid is called
        THEN it returns False
        """
        user = User.objects.create(google_id="gid-model-3", verified=True)
        token, _raw_token = RefreshToken.mint(user)
        token.expires_at = timezone.now() - timedelta(seconds=1)
        token.save(update_fields=["expires_at"])

        self.assertFalse(token.is_valid())

    def test_is_valid_true_when_not_revoked_and_not_expired(self):
        """
        GIVEN a refresh token that is not revoked and not expired
        WHEN is_valid is called
        THEN it returns True
        """
        user = User.objects.create(google_id="gid-model-4", verified=True)
        token, _raw_token = RefreshToken.mint(user)

        self.assertTrue(token.is_valid())

    def test_mint_with_parent_inherits_family(self):
        """
        GIVEN a parent refresh token
        WHEN a child refresh token is minted with parent set
        THEN the child links to parent and shares the same family_id
        """
        user = User.objects.create(google_id="gid-model-5", verified=True)
        parent, _parent_raw = RefreshToken.mint(user)

        child, _child_raw = RefreshToken.mint(user, parent=parent)

        self.assertEqual(child.parent_id, parent.id)
        self.assertEqual(child.family_id, parent.family_id)

    def test_revoke_family_only_revokes_active_tokens(self):
        """
        GIVEN a token family with both active and already-revoked tokens
        WHEN revoke_family is called
        THEN only active tokens are revoked with the provided reason
        """
        user = User.objects.create(google_id="gid-model-6", verified=True)
        token_a, _ = RefreshToken.mint(user)
        token_b, _ = RefreshToken.mint(user, family_id=token_a.family_id)
        token_c, _ = RefreshToken.mint(user, family_id=token_a.family_id)
        token_c.revoked_at = timezone.now()
        token_c.save(update_fields=["revoked_at"])

        revoked = RefreshToken.revoke_family(
            token_a.family_id,
            reason=RefreshToken.RevocationReason.REUSE_DETECTED,
        )

        token_a.refresh_from_db()
        token_b.refresh_from_db()
        token_c.refresh_from_db()

        self.assertEqual(revoked, 2)
        self.assertIsNotNone(token_a.revoked_at)
        self.assertIsNotNone(token_b.revoked_at)
        self.assertEqual(token_a.revoked_reason, RefreshToken.RevocationReason.REUSE_DETECTED)
        self.assertEqual(token_b.revoked_reason, RefreshToken.RevocationReason.REUSE_DETECTED)
        self.assertEqual(token_c.revoked_reason, "")

    def test_has_context_anomaly_detects_user_agent_mismatch(self):
        """
        GIVEN a refresh token with stored user-agent context
        WHEN has_context_anomaly is called with a different user-agent
        THEN it returns True
        """
        user = User.objects.create(google_id="gid-model-7", verified=True)
        token, _ = RefreshToken.mint(user, user_agent="ua-original", ip="203.0.113.10")

        result = token.has_context_anomaly(request_user_agent="ua-other", request_ip="203.0.113.11")

        self.assertTrue(result)

    def test_has_context_anomaly_allows_same_ipv4_24_network(self):
        """
        GIVEN a refresh token with stored IPv4 context
        WHEN has_context_anomaly is called with an IP in the same /24 network
        THEN it returns False
        """
        user = User.objects.create(google_id="gid-model-8", verified=True)
        token, _ = RefreshToken.mint(user, user_agent="ua-original", ip="203.0.113.10")

        result = token.has_context_anomaly(request_user_agent="ua-original", request_ip="203.0.113.77")

        self.assertFalse(result)
