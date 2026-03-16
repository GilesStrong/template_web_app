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

import redis
from django.test import TestCase

from appauth.modules.auth_rate_limit import _extract_client_ip, check_auth_rate_limit

_MODULE = "appauth.modules.auth_rate_limit"


class ExtractClientIpTests(TestCase):
    @patch(f"{_MODULE}.APP_SETTINGS")
    def test_explicit_empty_trusted_proxy_list_is_respected(self, mock_settings):
        """
        GIVEN app settings trust a proxy CIDR but call-site passes trusted_proxy_cidrs=[]
        WHEN _extract_client_ip is called
        THEN it treats the request as untrusted and returns REMOTE_ADDR instead of forwarded header
        """
        mock_settings.AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS = ["10.0.0.0/24"]

        request = SimpleNamespace(
            headers={"X-Forwarded-For": "203.0.113.8, 10.0.0.2"}, META={"REMOTE_ADDR": "10.0.0.3"}
        )

        self.assertEqual(_extract_client_ip(request, trusted_proxy_cidrs=[]), "10.0.0.3")

    def test_ignores_x_forwarded_for_when_remote_addr_not_trusted_proxy(self):
        """
        GIVEN a request with a spoofed X-Forwarded-For header from an untrusted REMOTE_ADDR
        WHEN _extract_client_ip is called
        THEN it ignores the header and returns REMOTE_ADDR
        """
        request = SimpleNamespace(
            headers={"X-Forwarded-For": "203.0.113.8, 10.0.0.2"}, META={"REMOTE_ADDR": "10.0.0.3"}
        )

        self.assertEqual(_extract_client_ip(request, trusted_proxy_cidrs=["127.0.0.1/32"]), "10.0.0.3")

    def test_prefers_first_x_forwarded_for_hop_when_remote_addr_is_trusted_proxy(self):
        """
        GIVEN a request from a trusted proxy with an X-Forwarded-For header containing multiple IPs
        WHEN _extract_client_ip is called
        THEN it returns the first (leftmost) IP in the header
        """
        request = SimpleNamespace(
            headers={"X-Forwarded-For": "203.0.113.8, 10.0.0.2"}, META={"REMOTE_ADDR": "10.0.0.3"}
        )

        self.assertEqual(_extract_client_ip(request, trusted_proxy_cidrs=["10.0.0.3/32"]), "203.0.113.8")

    def test_prefers_cf_connecting_ip_when_remote_addr_is_trusted_proxy(self):
        """
        GIVEN a request from a trusted proxy with both CF-Connecting-IP and X-Forwarded-For
        WHEN _extract_client_ip is called
        THEN it prefers and returns CF-Connecting-IP
        """
        request = SimpleNamespace(
            headers={"CF-Connecting-IP": "198.51.100.11", "X-Forwarded-For": "203.0.113.8, 10.0.0.2"},
            META={"REMOTE_ADDR": "10.0.0.3"},
        )

        self.assertEqual(_extract_client_ip(request, trusted_proxy_cidrs=["10.0.0.3/32"]), "198.51.100.11")

    def test_falls_back_to_remote_addr(self):
        """
        GIVEN a request with no X-Forwarded-For header but a REMOTE_ADDR in META
        WHEN _extract_client_ip is called
        THEN it returns the REMOTE_ADDR value
        """
        request = SimpleNamespace(headers={}, META={"REMOTE_ADDR": "10.0.0.3"})

        self.assertEqual(_extract_client_ip(request), "10.0.0.3")

    def test_returns_unknown_when_no_ip_data(self):
        """
        GIVEN a request with no X-Forwarded-For header and no REMOTE_ADDR in META
        WHEN _extract_client_ip is called
        THEN it returns the string 'unknown'
        """
        request = SimpleNamespace(headers={}, META={})

        self.assertEqual(_extract_client_ip(request), "unknown")


class CheckAuthRateLimitTests(TestCase):
    def test_disallows_when_limit_non_positive(self):
        """
        GIVEN a rate limit configured with a non-positive limit value
        WHEN check_auth_rate_limit is called
        THEN it immediately disallows the request and returns the window as retry_after_seconds
        """
        request = SimpleNamespace(headers={}, META={"REMOTE_ADDR": "10.0.0.3"})

        result = check_auth_rate_limit(request, action="exchange", limit=0, window_seconds=60)

        self.assertFalse(result.allowed)
        self.assertEqual(result.retry_after_seconds, 60)

    @patch(f"{_MODULE}.get_redis")
    @patch(f"{_MODULE}.time.time")
    def test_allows_under_limit_and_sets_expiry(self, mock_time, mock_get_redis):
        """
        GIVEN a Redis counter that is below the configured limit and a positive TTL
        WHEN check_auth_rate_limit is called
        THEN it allows the request, sets an expiry on the key, and returns the TTL as retry_after_seconds
        """
        mock_time.return_value = 1700000000
        redis_client = mock_get_redis.return_value
        redis_client.incr.return_value = 1
        redis_client.ttl.return_value = 55

        request = SimpleNamespace(headers={"X-Forwarded-For": "203.0.113.8"}, META={})
        result = check_auth_rate_limit(request, action="refresh", limit=3, window_seconds=60)

        self.assertTrue(result.allowed)
        self.assertEqual(result.retry_after_seconds, 55)
        redis_client.expire.assert_called_once()

    @patch(f"{_MODULE}.get_redis")
    @patch(f"{_MODULE}.time.time")
    def test_blocks_over_limit(self, mock_time, mock_get_redis):
        """
        GIVEN a Redis counter that exceeds the configured limit
        WHEN check_auth_rate_limit is called
        THEN it disallows the request and returns the remaining TTL as retry_after_seconds
        """
        mock_time.return_value = 1700000000
        redis_client = mock_get_redis.return_value
        redis_client.incr.return_value = 4
        redis_client.ttl.return_value = 42

        request = SimpleNamespace(headers={}, META={"REMOTE_ADDR": "10.0.0.3"})
        result = check_auth_rate_limit(request, action="exchange", limit=3, window_seconds=60)

        self.assertFalse(result.allowed)
        self.assertEqual(result.retry_after_seconds, 42)

    @patch(f"{_MODULE}.get_redis")
    @patch(f"{_MODULE}.time.time")
    def test_uses_window_when_ttl_missing(self, mock_time, mock_get_redis):
        """
        GIVEN a Redis counter below the limit but a TTL of -1 (key has no expiry)
        WHEN check_auth_rate_limit is called
        THEN it allows the request and falls back to the full window_seconds as retry_after_seconds
        """
        mock_time.return_value = 1700000000
        redis_client = mock_get_redis.return_value
        redis_client.incr.return_value = 2
        redis_client.ttl.return_value = -1

        request = SimpleNamespace(headers={}, META={"REMOTE_ADDR": "10.0.0.3"})
        result = check_auth_rate_limit(request, action="refresh", limit=5, window_seconds=60)

        self.assertTrue(result.allowed)
        self.assertEqual(result.retry_after_seconds, 60)

    @patch(f"{_MODULE}.get_redis")
    @patch(f"{_MODULE}.time.time")
    def test_fails_closed_on_redis_error_by_default(self, mock_time, mock_get_redis):
        """
        GIVEN Redis raises a RedisError during the incr call
        WHEN check_auth_rate_limit is called
        THEN it fails closed by denying the request and returns retry_after_seconds equal to window_seconds
        """
        mock_time.return_value = 1700000000
        redis_client = mock_get_redis.return_value
        redis_client.incr.side_effect = redis.RedisError("redis unavailable")

        request = SimpleNamespace(headers={}, META={"REMOTE_ADDR": "10.0.0.3"})
        result = check_auth_rate_limit(request, action="exchange", limit=3, window_seconds=60)

        self.assertFalse(result.allowed)
        self.assertEqual(result.retry_after_seconds, 60)

    @patch(f"{_MODULE}.get_redis")
    @patch(f"{_MODULE}.time.time")
    def test_can_fail_open_on_redis_error_when_explicitly_configured(self, mock_time, mock_get_redis):
        """
        GIVEN Redis raises a RedisError during the incr call and fail_open=True is passed
        WHEN check_auth_rate_limit is called
        THEN it allows the request and returns retry_after_seconds of 0
        """
        mock_time.return_value = 1700000000
        redis_client = mock_get_redis.return_value
        redis_client.incr.side_effect = redis.RedisError("redis unavailable")

        request = SimpleNamespace(headers={}, META={"REMOTE_ADDR": "10.0.0.3"})
        result = check_auth_rate_limit(request, action="exchange", limit=3, window_seconds=60, fail_open=True)

        self.assertTrue(result.allowed)
        self.assertEqual(result.retry_after_seconds, 0)
