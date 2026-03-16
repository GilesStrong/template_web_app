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

import ipaddress
import time
from dataclasses import dataclass

import redis
from app.app_settings import APP_SETTINGS
from appcore.modules.redis_client import get_redis
from django.http import HttpRequest


@dataclass(frozen=True)
class AuthRateLimitResult:
    allowed: bool
    retry_after_seconds: int


def _normalize_ip(value: str) -> str | None:
    """Return a normalized IP string when valid, otherwise None.

    Args:
        value: Candidate IP value.

    Returns:
        The canonical IP string when parsing succeeds; otherwise ``None``.
    """
    candidate = value.strip()
    if not candidate:
        return None

    try:
        parsed = ipaddress.ip_address(candidate)
    except ValueError:
        return None

    return str(parsed)


def _is_ip_in_trusted_proxy_ranges(client_ip: str, trusted_proxy_cidrs: list[str]) -> bool:
    """Check whether an IP belongs to any trusted proxy range.

    Args:
        client_ip: The normalized client IP string to test.
        trusted_proxy_cidrs: A list of trusted proxy CIDR blocks or single IPs.

    Returns:
        ``True`` when the IP matches at least one trusted range; otherwise ``False``.
    """
    if not trusted_proxy_cidrs:
        return False

    try:
        parsed_ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False

    for cidr_or_ip in trusted_proxy_cidrs:
        try:
            network = ipaddress.ip_network(cidr_or_ip, strict=False)
        except ValueError:
            continue

        if parsed_ip in network:
            return True

    return False


def _extract_client_ip(request: HttpRequest, trusted_proxy_cidrs: list[str] | None = None) -> str:
    """
    Extract the client's IP address from an HTTP request.

    This function uses a trust boundary model for proxy headers:
    forwarded headers are considered only when ``REMOTE_ADDR`` is inside a
    trusted proxy CIDR allowlist. Otherwise, forwarded headers are ignored.

    Args:
        request (HttpRequest): The incoming Django HTTP request object.
        trusted_proxy_cidrs (list[str] | None): Trusted proxy CIDR blocks or
            IP addresses. If omitted, values are read from
            ``APP_SETTINGS.AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS``.

    Returns:
        str: The resolved client IP address. Returns ``REMOTE_ADDR`` by default.
        If the request came from a trusted proxy and a valid forwarded IP is
        present, returns that forwarded IP. Returns ``"unknown"`` when no valid
        candidate exists.

    Notes:
        - ``CF-Connecting-IP`` is preferred over ``X-Forwarded-For`` when
          both are present from a trusted proxy.
        - The first hop from ``X-Forwarded-For`` is used, matching standard
          reverse-proxy behavior.
    """
    trusted_ranges = (
        APP_SETTINGS.AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS if trusted_proxy_cidrs is None else trusted_proxy_cidrs
    )

    remote_addr = _normalize_ip(request.META.get("REMOTE_ADDR", ""))
    if remote_addr is None:
        return "unknown"

    if not _is_ip_in_trusted_proxy_ranges(remote_addr, trusted_ranges):
        return remote_addr

    cloudflare_ip = _normalize_ip(request.headers.get("CF-Connecting-IP", ""))
    if cloudflare_ip is not None:
        return cloudflare_ip

    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        first_hop = _normalize_ip(forwarded_for.split(",")[0])
        if first_hop is not None:
            return first_hop

    return remote_addr


def check_auth_rate_limit(
    request: HttpRequest,
    *,
    action: str,
    limit: int,
    window_seconds: int = 60,
    fail_open: bool | None = None,
) -> AuthRateLimitResult:
    """
    Check whether an authentication action is within its rate limit for the requesting client.

    Evaluates a fixed-window rate limit backed by Redis. Each unique combination of
    action type and client IP address is tracked in a dedicated Redis key that expires
    after the configured window.

    Args:
        request (HttpRequest): The incoming Django HTTP request used to extract the
            client's IP address.
        action (str): A string identifier for the action being rate-limited
            (e.g. ``"login"``, ``"password_reset"``).
        limit (int): Maximum number of allowed attempts within the time window.
            A value of ``0`` or less unconditionally blocks the request.
        window_seconds (int, optional): Duration of the rate-limit window in seconds.
            Defaults to ``60``.
        fail_open (bool | None, optional): Redis failure policy override.
            - ``True``: allow request when Redis is unavailable.
            - ``False``: deny request when Redis is unavailable.
            - ``None``: use ``APP_SETTINGS.AUTH_RATE_LIMIT_FAIL_OPEN``.

    Returns:
        AuthRateLimitResult: A result object with two fields:

            * ``allowed`` (bool) – ``True`` if the request is within the limit,
              ``False`` if the limit has been exceeded or ``limit <= 0``.
            * ``retry_after_seconds`` (int) – Suggested number of seconds the caller
              should wait before retrying. Equals the remaining TTL of the Redis key
              when the limit is exceeded, or ``0`` when the request is allowed.

    Raises:
        None: All ``redis.RedisError`` exceptions are caught internally.

    Notes:
        * The Redis key is namespaced as ``rate:auth:<action>:<client_ip>:<bucket>``
          where ``bucket`` is derived by floor-dividing the current epoch time by
          ``window_seconds``, creating a fixed-window counter.
        * The TTL is set only on the first increment (``count == 1``) to avoid
          resetting the window on every request.
    """
    if limit <= 0:
        return AuthRateLimitResult(allowed=False, retry_after_seconds=window_seconds)

    client_ip = _extract_client_ip(request)
    bucket = time.time() // window_seconds
    key = f"rate:auth:{action}:{client_ip}:{int(bucket)}"

    try:
        redis_client = get_redis()
        count = int(redis_client.incr(key))  # type: ignore[arg-type]
        if count == 1:
            redis_client.expire(key, window_seconds)
        ttl = int(redis_client.ttl(key))  # type: ignore[arg-type]
        retry_after = ttl if ttl > 0 else window_seconds
        return AuthRateLimitResult(allowed=count <= limit, retry_after_seconds=retry_after)
    except redis.RedisError:
        effective_fail_open = APP_SETTINGS.AUTH_RATE_LIMIT_FAIL_OPEN if fail_open is None else fail_open
        if effective_fail_open:
            return AuthRateLimitResult(allowed=True, retry_after_seconds=0)
        return AuthRateLimitResult(allowed=False, retry_after_seconds=window_seconds)
