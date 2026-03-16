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

from app.app_settings import APP_SETTINGS
from google.auth.transport import requests
from google.oauth2 import id_token
from pydantic import BaseModel, ConfigDict, Field


class GoogleTokenVerificationResult(BaseModel):
    model_config = ConfigDict(frozen=True)
    verified: bool = Field(..., description="Indicates whether the Google token is valid and verified.")
    google_id: str = Field(..., description="The unique identifier of the user from Google if the token is valid.")


def verify_google_token(token: str) -> GoogleTokenVerificationResult:
    """
    Verifies the authenticity of a Google OAuth2 token.

    This function validates the provided Google token using the Google OAuth2
    verification process and checks that the token was issued by Google's
    authentication servers.

    Args:
        token (str): The Google OAuth2 ID token string to be verified.

    Returns:
        GoogleTokenVerificationResult: An object containing the verification result and Google ID.

    Raises:
        ValueError: If the token issuer is not 'accounts.google.com' or
                    'https://accounts.google.com'.
        google.auth.exceptions.GoogleAuthError: If the token is invalid, expired,
                                                or cannot be verified against the
                                                Google Client ID.
    """
    idinfo = id_token.verify_oauth2_token(
        token,
        requests.Request(),
        APP_SETTINGS.GOOGLE_CLIENT_ID,
    )

    if idinfo["iss"] not in ["accounts.google.com", "https://accounts.google.com"]:
        raise ValueError("Wrong issuer.")

    if APP_SETTINGS.GOOGLE_ENFORCE_ALLOWED_EMAILS and idinfo.get('email') not in APP_SETTINGS.GOOGLE_ALLOWED_EMAILS:
        raise ValueError("User not allowed.")

    return GoogleTokenVerificationResult(verified=idinfo.get('email_verified', False), google_id=idinfo['sub'])
