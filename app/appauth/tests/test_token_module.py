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

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from django.test import TestCase

from appauth.modules.token import AccessTokenAuth, decode_access_token, mint_access_token

_MODULE = "appauth.modules.token"
_USER_ID = UUID("12345678-1234-5678-1234-567812345678")


class MintAccessTokenTests(TestCase):
    """Tests for mint_access_token."""

    @patch(f"{_MODULE}.jwt.encode")
    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.datetime")
    def test_mints_hs256_token_with_expected_claims(self, mock_datetime, mock_settings, mock_encode):
        """
        GIVEN a user ID and configured JWT settings
        WHEN mint_access_token is called
        THEN it encodes a payload with issuer, audience, subject, iat, exp, and typ claims using HS256
        """
        frozen_now = datetime(2026, 2, 27, 12, 0, 0, tzinfo=timezone.utc)
        mock_datetime.now.return_value = frozen_now
        mock_settings.JWT_ISSUER = "myapp"
        mock_settings.JWT_AUDIENCE = "myapp-api"
        mock_settings.JWT_SIGNING_KEY = "test-signing-key"
        mock_settings.ACCESS_TOKEN_TTL_SECONDS = 900
        mock_encode.return_value = "encoded-token"

        token = mint_access_token(user_id=_USER_ID)

        expected_payload = {
            "iss": "myapp",
            "aud": "myapp-api",
            "sub": str(_USER_ID),
            "iat": int(frozen_now.timestamp()),
            "exp": int((frozen_now.timestamp()) + 900),
            "typ": "access",
        }
        mock_encode.assert_called_once_with(expected_payload, "test-signing-key", algorithm="HS256")
        self.assertEqual(token, "encoded-token")


class DecodeAccessTokenTests(TestCase):
    """Tests for decode_access_token."""

    @patch(f"{_MODULE}.jwt.decode")
    @patch(f"{_MODULE}.APP_SETTINGS")
    def test_decodes_with_required_claims_and_validators(self, mock_settings, mock_decode):
        """
        GIVEN an encoded access token and JWT settings
        WHEN decode_access_token is called
        THEN jwt.decode is called with audience, issuer, HS256, and required claim options
        """
        mock_settings.JWT_SIGNING_KEY = "test-signing-key"
        mock_settings.JWT_AUDIENCE = "myapp-api"
        mock_settings.JWT_ISSUER = "myapp"
        mock_decode.return_value = {"sub": str(_USER_ID), "typ": "access"}

        payload = decode_access_token("token-value")

        mock_decode.assert_called_once_with(
            "token-value",
            "test-signing-key",
            algorithms=["HS256"],
            audience="myapp-api",
            issuer="myapp",
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
        self.assertEqual(payload["typ"], "access")


class AccessTokenAuthTests(TestCase):
    """Tests for AccessTokenAuth.authenticate."""

    @patch(f"{_MODULE}.User")
    @patch(f"{_MODULE}.decode_access_token")
    def test_returns_user_for_valid_access_token(self, mock_decode, mock_user_cls):
        """
        GIVEN a valid decoded access token payload with typ='access' and existing user
        WHEN AccessTokenAuth.authenticate is called
        THEN it returns the resolved user instance
        """
        expected_user = SimpleNamespace(id=_USER_ID)
        mock_decode.return_value = {"typ": "access", "sub": str(_USER_ID)}
        mock_user_cls.objects.get.return_value = expected_user

        result = AccessTokenAuth().authenticate(SimpleNamespace(), "token")

        self.assertEqual(result, expected_user)

    @patch(f"{_MODULE}.User")
    @patch(f"{_MODULE}.decode_access_token")
    def test_returns_none_for_non_access_typ(self, mock_decode, mock_user_cls):
        """
        GIVEN a decoded token payload with typ not equal to 'access'
        WHEN AccessTokenAuth.authenticate is called
        THEN it returns None and does not query the user model
        """
        mock_decode.return_value = {"typ": "refresh", "sub": str(_USER_ID)}

        result = AccessTokenAuth().authenticate(SimpleNamespace(), "token")

        self.assertIsNone(result)
        mock_user_cls.objects.get.assert_not_called()

    @patch(f"{_MODULE}.decode_access_token")
    def test_returns_none_for_decode_error(self, mock_decode):
        """
        GIVEN token decoding raises a JWT error
        WHEN AccessTokenAuth.authenticate is called
        THEN it returns None
        """
        import jwt

        mock_decode.side_effect = jwt.DecodeError("bad token")

        result = AccessTokenAuth().authenticate(SimpleNamespace(), "token")

        self.assertIsNone(result)
