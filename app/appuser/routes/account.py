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

import secrets

from appauth.modules.auth import get_user_from_request
from appauth.modules.auth_rate_limit import check_auth_rate_limit
from django.core.cache import cache
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import HttpRequest
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError

from appuser.serializers.account import (
    DeleteAccountIn,
    DeleteAccountRequestOut,
    ExportDataOut,
    ExportUserOut,
)

router = Router(tags=['user'])

DELETE_CONFIRMATION_TTL_SECONDS = 900
DELETE_REQUEST_COOLDOWN_SECONDS = 30
EXPORT_ACCOUNT_LIMIT_PER_HOUR = 3
EXPORT_ACCOUNT_WINDOW_SECONDS = 3600
DELETE_SIGNING_SALT = 'appuser.delete_account'
DELETE_NONCE_CACHE_KEY_PREFIX = 'delete-account-nonce'
DELETE_COOLDOWN_CACHE_KEY_PREFIX = 'delete-account-cooldown'


def _nonce_cache_key(user_id: str) -> str:
    """
    Build the cache key used for the latest deletion nonce for a user.

    Args:
        user_id: The user ID represented as a string.

    Returns:
        The cache key for the user's active deletion nonce.
    """
    return f'{DELETE_NONCE_CACHE_KEY_PREFIX}:{user_id}'


def _cooldown_cache_key(user_id: str) -> str:
    """
    Build the cache key used for delete-request cooldown state.

    Args:
        user_id: The user ID represented as a string.

    Returns:
        The cache key that tracks the user's deletion-request cooldown.
    """
    return f'{DELETE_COOLDOWN_CACHE_KEY_PREFIX}:{user_id}'


def _issue_delete_confirmation_token(user_id: str) -> str:
    """
    Create and store a short-lived deletion confirmation token.

    Args:
        user_id: The authenticated user's ID represented as a string.

    Returns:
        A signed token containing user_id and a random nonce.
    """
    nonce = secrets.token_urlsafe(24)
    cache.set(_nonce_cache_key(user_id), nonce, timeout=DELETE_CONFIRMATION_TTL_SECONDS)
    signer = TimestampSigner(salt=DELETE_SIGNING_SALT)
    return signer.sign(f'{user_id}:{nonce}')


def _validate_delete_confirmation_token(user_id: str, confirmation_token: str) -> None:
    """
    Validate delete confirmation token integrity, age, and nonce match.

    Args:
        user_id: The authenticated user's ID represented as a string.
        confirmation_token: The signed token supplied by the caller.

    Raises:
        HttpError: If the token is invalid, expired, belongs to another user,
            or no longer matches the latest active nonce.
    """
    signer = TimestampSigner(salt=DELETE_SIGNING_SALT)

    try:
        raw_value = signer.unsign(confirmation_token, max_age=DELETE_CONFIRMATION_TTL_SECONDS)
    except SignatureExpired:
        raise HttpError(400, 'Confirmation token expired. Request a new deletion token.')
    except BadSignature:
        raise HttpError(400, 'Invalid confirmation token.')

    token_user_id, _, token_nonce = raw_value.partition(':')
    if token_user_id != user_id or not token_nonce:
        raise HttpError(400, 'Invalid confirmation token.')

    expected_nonce = cache.get(_nonce_cache_key(user_id))
    if expected_nonce != token_nonce:
        raise HttpError(400, 'Confirmation token is no longer valid. Request a new deletion token.')


def _check_export_rate_limit(request: HttpRequest) -> None:
    """
    Enforce the account export rate limit for the requesting client.

    Args:
        request: The incoming request used to derive the rate-limit key.

    Raises:
        HttpError: If account export requests exceed the configured hourly limit.
    """
    rate_limit = check_auth_rate_limit(
        request,
        action='account-export',
        limit=EXPORT_ACCOUNT_LIMIT_PER_HOUR,
        window_seconds=EXPORT_ACCOUNT_WINDOW_SECONDS,
    )
    if not rate_limit.allowed:
        raise HttpError(429, f'Too many account export attempts. Retry in {rate_limit.retry_after_seconds}s')


@router.get(
    '/me/export/',
    summary='Export account data',
    description='Export all account data for the authenticated user in a machine-readable JSON payload.',
    response={200: ExportDataOut},
    operation_id='export_account_data',
)
def export_account_data(request: HttpRequest) -> ExportDataOut:
    """
    Export all account data for the authenticated user.

    Args:
        request: The incoming HTTP request containing authenticated user context.

    Returns:
        A full export payload containing relevant user data

    Raises:
        HttpError: If account export requests exceed the allowed hourly rate limit.
    """
    _check_export_rate_limit(request)
    user = get_user_from_request(request)

    return ExportDataOut(
        exported_at=timezone.now().isoformat(),
        user=ExportUserOut(
            id=user.id,
            google_id=user.google_id,
            verified=user.verified,
        ),
    )


@router.post(
    '/me/delete-request/',
    summary='Request account deletion confirmation token',
    description='Start account deletion by issuing a short-lived confirmation token.',
    response={200: DeleteAccountRequestOut},
    operation_id='request_account_deletion',
)
def request_delete_account(request: HttpRequest) -> DeleteAccountRequestOut:
    """
    Start the first step of account deletion for the authenticated user.

    This endpoint enforces a short cooldown window to reduce accidental repeated
    requests and returns a short-lived confirmation token for step two.

    Args:
        request: The incoming HTTP request containing authenticated user context.

    Returns:
        A response containing a deletion confirmation token and its TTL in seconds.

    Raises:
        HttpError: If the cooldown window has not elapsed since the previous
            delete-request call for this user.
    """
    user = get_user_from_request(request)
    user_id = str(user.id)
    cooldown_key = _cooldown_cache_key(user_id)

    if cache.get(cooldown_key):
        raise HttpError(
            429,
            f'Deletion request is cooling down. Try again in {DELETE_REQUEST_COOLDOWN_SECONDS} seconds.',
        )

    cache.set(cooldown_key, True, timeout=DELETE_REQUEST_COOLDOWN_SECONDS)
    token = _issue_delete_confirmation_token(user_id)
    return DeleteAccountRequestOut(
        confirmation_token=token,
        expires_in_seconds=DELETE_CONFIRMATION_TTL_SECONDS,
    )


@router.delete(
    '/me/',
    summary='Delete account with confirmation token',
    description='Complete account deletion using a short-lived confirmation token issued by delete-request endpoint.',
    response={204: None},
    operation_id='delete_account',
)
def delete_account(request: HttpRequest, payload: DeleteAccountIn) -> None:
    """
    Delete the authenticated user account after token confirmation.

    Args:
        request: The incoming HTTP request containing authenticated user context.
        payload: The delete-account payload containing the confirmation token.

    Returns:
        ``None`` on successful deletion.

    Raises:
        HttpError: If the confirmation token is missing, expired, invalid, or no
            longer active for this user.
    """
    user = get_user_from_request(request)
    user_id = str(user.id)

    _validate_delete_confirmation_token(user_id, payload.confirmation_token)

    cache.delete(_nonce_cache_key(user_id))
    cache.delete(_cooldown_cache_key(user_id))
    user.delete()
    return None
