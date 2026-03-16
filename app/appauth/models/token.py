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

import ipaddress
import secrets
import uuid
from datetime import timedelta
from hashlib import sha256
from typing import Self

from app.app_settings import APP_SETTINGS
from appuser.models import User
from django.db import models
from django.utils import timezone


class RefreshToken(models.Model):
    class RevocationReason(models.TextChoices):
        ROTATED = "rotated", "rotated"
        REUSE_DETECTED = "reuse_detected", "reuse_detected"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="refresh_tokens")
    token = models.CharField(max_length=128, unique=True, db_index=True)
    family_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    replaced_by = models.OneToOneField(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replaced_token"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=32, blank=True, default="")
    user_agent = models.TextField(blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)

    @staticmethod
    def hash_token(raw_token: str) -> str:
        """
        Hashes a raw token string using the SHA-256 algorithm.

        Args:
            raw_token (str): The raw token string to be hashed.

        Returns:
            str: The hexadecimal representation of the SHA-256 hash of the raw token.
        """
        return sha256(raw_token.encode("utf-8")).hexdigest()

    @classmethod
    def mint(
        cls,
        user: User,
        *,
        user_agent: str = "",
        ip: str | None = None,
        parent: "RefreshToken | None" = None,
        family_id: uuid.UUID | None = None,
    ) -> tuple["RefreshToken", str]:
        """
        Create and store a new refresh token for the given user.

        This class method generates a cryptographically secure random token,
        hashes it for storage, and persists a new ``RefreshToken`` record with
        an expiry calculated from ``APP_SETTINGS.REFRESH_TOKEN_TTL_SECONDS``.

        Args:
            user (User): The authenticated user for whom the token is minted.
            user_agent (str, optional): The client's User-Agent string. Truncated
                to 1000 characters. Defaults to an empty string.
            ip (str | None, optional): The client's IP address. Defaults to None.
            parent (RefreshToken | None, optional): The previous token in the
                rotation chain, if this token is minted during refresh.
            family_id (uuid.UUID | None, optional): Token family identifier used
                for replay/reuse detection and family-wide revocation. If omitted,
                a value is inferred from ``parent`` or generated anew.

        Returns:
            tuple[RefreshToken, str]: A two-element tuple containing:
                - The newly created ``RefreshToken`` database record.
                - The raw (unhashed) token string to be delivered to the client.

        Note:
            Only the hashed version of the token is stored in the database.
            The raw token is returned exactly once and cannot be recovered later.
        """
        now = timezone.now()
        raw_token = secrets.token_urlsafe(48)
        resolved_family_id = family_id or (parent.family_id if parent is not None else uuid.uuid4())
        record = cls.objects.create(
            user=user,
            token=cls.hash_token(raw_token),
            family_id=resolved_family_id,
            parent=parent,
            expires_at=now + timedelta(seconds=APP_SETTINGS.REFRESH_TOKEN_TTL_SECONDS),
            user_agent=user_agent[:1000],
            ip=ip,
        )
        return record, raw_token

    @classmethod
    def from_raw_token(cls, raw_token: str) -> Self:
        """
        Retrieve a RefreshToken instance by searching with either a hashed or raw token value.

        This class method first attempts to find a token by its hashed value. If no match
        is found, it falls back to searching with the raw token string directly.
        The returned instance will have its related user pre-fetched via select_related.

        Args:
            raw_token (str): The raw (unhashed) token string to search for.

        Returns:
            RefreshToken: The RefreshToken instance associated with the given token,
                          with the related user pre-fetched.

        Raises:
            cls.DoesNotExist: If no matching token is found using either the hashed
                              or raw token value.
        """
        token_hash = cls.hash_token(raw_token)
        try:
            return cls.objects.select_related("user").get(token=token_hash)
        except cls.DoesNotExist:
            return cls.objects.select_related("user").get(token=raw_token)

    def is_valid(self) -> bool:
        """
        Check if the token is valid.

        A token is considered valid if it has not been revoked and has not expired.

        Returns:
            bool: True if the token is valid, False otherwise.
                - Returns False if the token has been revoked (revoked_at is not None).
                - Returns True if the current time is before the token's expiration time.
                - Returns False if the token has expired.
        """
        if self.revoked_at is not None:
            return False
        return timezone.now() < self.expires_at

    def looks_like_rotated_token_reuse(self) -> bool:
        """
        Return True when this token appears to have been replayed after rotation.

        A revoked token that has a ``replaced_by`` successor indicates normal
        rotation has already happened, so receiving that token again is treated as
        suspicious refresh-token reuse.

        Returns:
            bool: True if this token has been revoked and has a non-null replaced_by reference,
                  indicating it was rotated and the old token is being reused. False otherwise.
        """
        return self.revoked_at is not None and getattr(self, "replaced_by", None) is not None

    def has_context_anomaly(self, *, request_user_agent: str, request_ip: str | None) -> bool:
        """Return True when refresh request context deviates from token context.

        A request is treated as anomalous when either:

        - both stored and request user-agent values are present and differ, or
        - both stored and request IP values are present and they are not in the
          same trusted network block (IPv4 /24, IPv6 /56).

        Args:
            request_user_agent: The user-agent value from the incoming refresh request.
            request_ip: The resolved client IP value from the incoming refresh request.

        Returns:
            bool: ``True`` when context mismatch is detected, otherwise ``False``.
        """
        stored_user_agent = (self.user_agent or "").strip()
        current_user_agent = request_user_agent.strip()
        if stored_user_agent and current_user_agent and stored_user_agent != current_user_agent:
            return True

        stored_ip = self.ip
        current_ip = request_ip
        if not stored_ip or not current_ip:
            return False

        return not self._ip_in_same_network(stored_ip, current_ip)

    @staticmethod
    def _ip_in_same_network(stored_ip: str, current_ip: str) -> bool:
        """Check whether two IP addresses belong to the same comparison network.

        For anomaly detection this compares:

        - IPv4 using /24 network blocks
        - IPv6 using /56 network blocks

        Args:
            stored_ip: The IP value persisted with the refresh token.
            current_ip: The IP value from the incoming refresh request.

        Returns:
            bool: ``True`` when both values parse and are within the same
            comparison network, otherwise ``False``.
        """
        try:
            stored_addr = ipaddress.ip_address(stored_ip)
            current_addr = ipaddress.ip_address(current_ip)
        except ValueError:
            return False

        if stored_addr.version != current_addr.version:
            return False

        prefix = 24 if stored_addr.version == 4 else 56
        network = ipaddress.ip_network(f"{stored_addr}/{prefix}", strict=False)
        return current_addr in network

    @classmethod
    def revoke_family(cls, family_id: uuid.UUID, *, reason: str) -> int:
        """
        Revoke all still-active refresh tokens within a family.

        Returns:
            int: Number of tokens revoked by this operation.
        """
        return cls.objects.filter(family_id=family_id, revoked_at__isnull=True).update(
            revoked_at=timezone.now(),
            revoked_reason=reason,
        )
