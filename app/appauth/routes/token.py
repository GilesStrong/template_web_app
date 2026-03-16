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
from appuser.models import User
from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError

from appauth.models.token import RefreshToken
from appauth.modules.auth_rate_limit import _extract_client_ip, check_auth_rate_limit
from appauth.modules.google_auth import verify_google_token
from appauth.modules.token import mint_access_token
from appauth.serializers.token import ExchangeIn, ExchangeOut, RefreshIn

router = Router(tags=["auth"])


def _is_legacy_proxy_ip_context(
    *,
    token_ip: str | None,
    remote_addr: str | None,
    resolved_client_ip: str | None,
) -> bool:
    """Return True when token IP appears to be a legacy proxy-stored IP.

    This handles compatibility for refresh tokens minted before trusted-client
    extraction was applied at exchange time. In that legacy shape, ``token_ip``
    matches ``REMOTE_ADDR`` (proxy hop), while ``resolved_client_ip`` reflects
    the forwarded client address.

    Args:
        token_ip: IP stored on refresh token.
        remote_addr: Current request ``REMOTE_ADDR`` value.
        resolved_client_ip: Trusted resolved client IP for the request.

    Returns:
        bool: True when values match the legacy proxy-IP pattern.
    """
    if not token_ip or not remote_addr or not resolved_client_ip:
        return False

    stored = token_ip.strip()
    remote = remote_addr.strip()
    resolved = resolved_client_ip.strip()

    if not stored or not remote or not resolved:
        return False

    return stored == remote and resolved != remote


@router.post(
    "/exchange/",
    response=ExchangeOut,
    summary="Exchange Google ID token for access and refresh tokens",
    description="Exchange a Google ID token for an access token and a refresh token. The access token can be used to authenticate API requests, while the refresh token can be used to obtain new access tokens when the current one expires.",
    operation_id="exchange_google_token",
)
def exchange(request: HttpRequest, payload: ExchangeIn) -> ExchangeOut:
    """
    Exchange a Google ID token for access and refresh tokens.

    Validates the provided Google ID token, performs rate limiting, and returns
    a new access token and refresh token pair for the authenticated user.

    Args:
        request (HttpRequest): The incoming HTTP request object, used for rate
            limiting and extracting client metadata (User-Agent, IP address).
        payload (ExchangeIn): The request payload containing the Google ID token
            to be exchanged.

    Returns:
        ExchangeOut: An object containing the newly minted access token and
            refresh token.

    Raises:
        HttpError(429): If the rate limit for token exchange attempts is exceeded.
            The response includes the number of seconds to wait before retrying.
        HttpError(401): If the Google ID token is invalid or the associated email
            address has not been verified.

    Notes:
        - If no user exists with the given Google ID, a new user account is
          automatically created.
        - The refresh token is associated with the client's User-Agent and IP
          address for security tracking purposes.
    """
    rate_limit = check_auth_rate_limit(
        request,
        action="exchange",
        limit=APP_SETTINGS.AUTH_EXCHANGE_PER_MINUTE,
        fail_open=False,
    )
    if not rate_limit.allowed:
        raise HttpError(429, f"Too many token exchange attempts. Retry in {rate_limit.retry_after_seconds}s")

    ident = verify_google_token(payload.google_id_token)

    if not ident.verified:
        raise HttpError(401, "Email not verified")

    user, _created = User.objects.get_or_create(
        google_id=ident.google_id,
        defaults={"verified": ident.verified},
    )

    resolved_request_ip = _extract_client_ip(request)
    request_ip = None if resolved_request_ip == "unknown" else resolved_request_ip

    access = mint_access_token(user_id=user.id)
    _rt, raw_refresh_token = RefreshToken.mint(
        user,
        user_agent=request.headers.get("User-Agent", ""),
        ip=request_ip,
    )
    return ExchangeOut(access_token=access, refresh_token=raw_refresh_token)


@router.post(
    "/refresh/",
    response=ExchangeOut,
    summary="Refresh access token using refresh token",
    description="Use a valid refresh token to obtain a new access token. This endpoint will also rotate the refresh token, invalidating the old one and issuing a new one.",
    operation_id="refresh_access_token",
)
def refresh(request: HttpRequest, payload: RefreshIn) -> ExchangeOut:
    """
    Refresh an access token using a valid refresh token.

    This endpoint implements refresh token rotation: upon successful validation,
    the provided refresh token is immediately revoked and a new refresh token is
    issued alongside a fresh access token.

    Args:
        request (HttpRequest): The incoming HTTP request object, used for rate
            limiting, IP address extraction, and User-Agent header retrieval.
        payload (RefreshIn): Request body containing the refresh token to be
            exchanged.

    Returns:
        ExchangeOut: A response object containing:
            - access_token (str): A newly minted JWT access token.
            - refresh_token (str): A newly issued raw refresh token, replacing
              the one that was consumed during this request.

    Raises:
        HttpError(429): If the caller has exceeded the allowed number of refresh
            attempts per minute (``AUTH_REFRESH_PER_MINUTE``). The response
            includes a ``retry_after_seconds`` hint.
        HttpError(401): If the provided refresh token does not exist in the
            database (``"Invalid refresh token"``).
        HttpError(401): If the provided refresh token has expired or has already
            been revoked (``"Refresh token expired or revoked"``).

    Notes:
        - Refresh token rotation ensures that each refresh token can only be used
          once, mitigating replay attacks.
        - The old refresh token's ``revoked_at`` timestamp is set to the current
          time before the new token pair is minted.
        - Rate limiting is enforced per request via ``check_auth_rate_limit``.
    """
    rate_limit = check_auth_rate_limit(
        request,
        action="refresh",
        limit=APP_SETTINGS.AUTH_REFRESH_PER_MINUTE,
        fail_open=False,
    )
    if not rate_limit.allowed:
        raise HttpError(429, f"Too many token refresh attempts. Retry in {rate_limit.retry_after_seconds}s")

    try:
        rt = RefreshToken.from_raw_token(payload.refresh_token)
    except RefreshToken.DoesNotExist:
        raise HttpError(401, "Invalid refresh token")

    request_user_agent = request.headers.get("User-Agent", "")
    request_remote_addr = request.META.get("REMOTE_ADDR")
    resolved_request_ip = _extract_client_ip(request)
    request_ip = None if resolved_request_ip == "unknown" else resolved_request_ip

    is_invalid = False
    revoke_family_id = None
    revoke_family_reason = ""
    new_raw_refresh_token = ""
    with transaction.atomic():
        rt = RefreshToken.objects.select_for_update().select_related("user").get(pk=rt.pk)

        if not rt.is_valid():
            is_invalid = True
            if rt.looks_like_rotated_token_reuse():
                revoke_family_id = rt.family_id
                revoke_family_reason = RefreshToken.RevocationReason.REUSE_DETECTED[0]
        else:
            has_context_anomaly = rt.has_context_anomaly(request_user_agent=request_user_agent, request_ip=request_ip)
            is_legacy_proxy_ip_context = _is_legacy_proxy_ip_context(
                token_ip=rt.ip,
                remote_addr=request_remote_addr,
                resolved_client_ip=request_ip,
            )

            if has_context_anomaly and not is_legacy_proxy_ip_context:
                is_invalid = True
                revoke_family_id = rt.family_id
                revoke_family_reason = "context_mismatch"
            else:
                new_rt, new_raw_refresh_token = RefreshToken.mint(
                    rt.user,
                    user_agent=request_user_agent,
                    ip=request_ip,
                    parent=rt,
                    family_id=rt.family_id,
                )

                RefreshToken.objects.filter(pk=rt.pk).update(
                    revoked_at=timezone.now(),
                    revoked_reason=RefreshToken.RevocationReason.ROTATED,
                    replaced_by_id=new_rt.pk,
                )

    if is_invalid:
        if revoke_family_id is not None:
            RefreshToken.revoke_family(
                revoke_family_id,
                reason=revoke_family_reason,
            )
        raise HttpError(401, "Refresh token expired or revoked")

    access = mint_access_token(user_id=rt.user.id)
    return ExchangeOut(access_token=access, refresh_token=new_raw_refresh_token)
