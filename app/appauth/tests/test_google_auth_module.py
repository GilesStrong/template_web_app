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

from unittest.mock import patch

from django.test import TestCase

from appauth.modules.google_auth import verify_google_token

_MODULE = "appauth.modules.google_auth"


class VerifyGoogleTokenTests(TestCase):
    """Tests for verify_google_token."""

    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.requests.Request")
    @patch(f"{_MODULE}.id_token.verify_oauth2_token")
    def test_returns_verified_result_for_valid_issuer(self, mock_verify, mock_request, mock_settings):
        """
        GIVEN a Google ID token with a valid issuer and verified email
        WHEN verify_google_token is called with allowed-list enforcement disabled
        THEN it returns a verified result with the Google user ID
        """
        mock_settings.GOOGLE_CLIENT_ID = "google-client-id"
        mock_settings.GOOGLE_ENFORCE_ALLOWED_EMAILS = False
        mock_verify.return_value = {
            "iss": "accounts.google.com",
            "email_verified": True,
            "email": "user@example.com",
            "sub": "google-user-123",
        }

        result = verify_google_token("id-token")

        mock_verify.assert_called_once_with("id-token", mock_request.return_value, "google-client-id")
        self.assertTrue(result.verified)
        self.assertEqual(result.google_id, "google-user-123")

    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.requests.Request")
    @patch(f"{_MODULE}.id_token.verify_oauth2_token")
    def test_raises_for_wrong_issuer(self, mock_verify, _mock_request, mock_settings):
        """
        GIVEN a Google ID token whose issuer is not accepted
        WHEN verify_google_token is called
        THEN it raises ValueError
        """
        mock_settings.GOOGLE_CLIENT_ID = "google-client-id"
        mock_settings.GOOGLE_ENFORCE_ALLOWED_EMAILS = False
        mock_verify.return_value = {
            "iss": "https://malicious.example.com",
            "email_verified": True,
            "email": "user@example.com",
            "sub": "google-user-123",
        }

        with self.assertRaises(ValueError):
            verify_google_token("id-token")

    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.requests.Request")
    @patch(f"{_MODULE}.id_token.verify_oauth2_token")
    def test_returns_verified_result_when_email_in_allowed_list(self, mock_verify, mock_request, mock_settings):
        """
        GIVEN a Google ID token with a valid issuer and an email present in the allowed list
        WHEN verify_google_token is called with allowed-list enforcement enabled
        THEN it returns a verified result with the Google user ID
        """
        mock_settings.GOOGLE_CLIENT_ID = "google-client-id"
        mock_settings.GOOGLE_ENFORCE_ALLOWED_EMAILS = True
        mock_settings.GOOGLE_ALLOWED_EMAILS = ["allowed@example.com", "other@example.com"]
        mock_verify.return_value = {
            "iss": "accounts.google.com",
            "email_verified": True,
            "email": "allowed@example.com",
            "sub": "google-user-123",
        }

        result = verify_google_token("id-token")

        mock_verify.assert_called_once_with("id-token", mock_request.return_value, "google-client-id")
        self.assertTrue(result.verified)
        self.assertEqual(result.google_id, "google-user-123")

    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.requests.Request")
    @patch(f"{_MODULE}.id_token.verify_oauth2_token")
    def test_raises_when_email_not_in_allowed_list(self, mock_verify, _mock_request, mock_settings):
        """
        GIVEN a Google ID token with a valid issuer but an email absent from the allowed list
        WHEN verify_google_token is called with allowed-list enforcement enabled
        THEN it raises ValueError
        """
        mock_settings.GOOGLE_CLIENT_ID = "google-client-id"
        mock_settings.GOOGLE_ENFORCE_ALLOWED_EMAILS = True
        mock_settings.GOOGLE_ALLOWED_EMAILS = ["allowed@example.com"]
        mock_verify.return_value = {
            "iss": "accounts.google.com",
            "email_verified": True,
            "email": "notallowed@example.com",
            "sub": "google-user-456",
        }

        with self.assertRaises(ValueError):
            verify_google_token("id-token")

    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.requests.Request")
    @patch(f"{_MODULE}.id_token.verify_oauth2_token")
    def test_skips_allowed_list_check_when_enforcement_disabled(self, mock_verify, _mock_request, mock_settings):
        """
        GIVEN a Google ID token with a valid issuer and an email absent from the allowed list
        WHEN verify_google_token is called with allowed-list enforcement disabled
        THEN it returns a result without raising ValueError
        """
        mock_settings.GOOGLE_CLIENT_ID = "google-client-id"
        mock_settings.GOOGLE_ENFORCE_ALLOWED_EMAILS = False
        mock_settings.GOOGLE_ALLOWED_EMAILS = ["allowed@example.com"]
        mock_verify.return_value = {
            "iss": "accounts.google.com",
            "email_verified": True,
            "email": "notallowed@example.com",
            "sub": "google-user-456",
        }

        result = verify_google_token("id-token")

        self.assertEqual(result.google_id, "google-user-456")
