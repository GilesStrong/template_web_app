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

from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from app.app_settings import APP_SETTINGS
from appcore.modules.beartype import beartype
from appuser.models import User
from django.http import HttpRequest
from ninja.security import HttpBearer


@beartype
def mint_access_token(*, user_id: UUID) -> str:
    """
    Mint a new JWT access token for the given user.

    Args:
        user_id (UUID): The unique identifier of the user for whom the token is being minted.

    Returns:
        str: A signed JWT access token encoded with HS256 algorithm.

    Notes:
        The token payload contains the following claims:
            - iss (str): The token issuer, as defined in settings.JWT_ISSUER.
            - aud (str): The token audience, as defined in settings.JWT_AUDIENCE.
            - sub (str): The subject of the token, which is the string representation of user_id.
            - iat (int): The time at which the token was issued, as a Unix timestamp.
            - exp (int): The expiration time of the token, as a Unix timestamp.
                         Calculated by adding settings.ACCESS_TOKEN_TTL_SECONDS to the issued time.
            - typ (str): The token type, set to "access".
    """
    now = datetime.now(timezone.utc)
    payload = {
        "iss": APP_SETTINGS.JWT_ISSUER,
        "aud": APP_SETTINGS.JWT_AUDIENCE,
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=APP_SETTINGS.ACCESS_TOKEN_TTL_SECONDS)).timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, APP_SETTINGS.JWT_SIGNING_KEY, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    """
    Decode and validate a JWT access token.

    Args:
        token (str): The JWT access token string to be decoded.

    Returns:
        dict: A dictionary containing the decoded token claims/payload,
              including required fields: expiration time (exp),
              issued at (iat), subject (sub), audience (aud),
              and issuer (iss).

    Raises:
        jwt.ExpiredSignatureError: If the token has expired.
        jwt.InvalidAudienceError: If the token audience doesn't match the expected audience.
        jwt.InvalidIssuerError: If the token issuer doesn't match the expected issuer.
        jwt.MissingRequiredClaimError: If any of the required claims (exp, iat, sub, aud, iss)
                                       are missing from the token.
        jwt.DecodeError: If the token cannot be decoded or the signature is invalid.
    """
    return jwt.decode(
        token,
        APP_SETTINGS.JWT_SIGNING_KEY,
        algorithms=["HS256"],
        audience=APP_SETTINGS.JWT_AUDIENCE,
        issuer=APP_SETTINGS.JWT_ISSUER,
        options={"require": ["exp", "iat", "sub", "aud", "iss"]},
    )


class AccessTokenAuth(HttpBearer):
    cookie_name = "backend_access_token"
    """
    HTTP Bearer token authentication class for access token validation.

    Authenticates incoming HTTP requests by decoding and validating JWT access tokens.

    Args:
        request (HttpRequest): The incoming HTTP request object.
        token (str): The JWT Bearer token extracted from the Authorization header.

    Returns:
        User | None: The authenticated User instance if the token is valid,
            or None if authentication fails for any of the following reasons:
                - The token cannot be decoded or is invalid.
                - The token type ('typ' claim) is not 'access'.
                - The user ID ('sub' claim) does not correspond to an existing user.
                - Any PyJWT error, ValueError, or User.DoesNotExist exception is raised.
    """

    def authenticate(self, request: HttpRequest, token: str) -> User | None:
        try:
            payload = decode_access_token(token)
            if payload.get("typ") != "access":
                return None
            user_id = UUID(payload["sub"])
            return User.objects.get(id=user_id)
        except (jwt.PyJWTError, ValueError, User.DoesNotExist):
            return None

    def __call__(self, request: HttpRequest) -> User | None:
        user = super().__call__(request)
        if user is not None:
            return user

        cookie_token = request.COOKIES.get(self.cookie_name)
        if not cookie_token:
            return None

        return self.authenticate(request, cookie_token)
