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

from appcore.modules.beartype import beartype
from appcore.modules.redis_client import get_redis

_BEARTYPE_MODULE = "appcore.modules.beartype"
_REDIS_MODULE = "appcore.modules.redis_client"


def _sample_function(value: int) -> int:
    return value + 1


class BeartypeWrapperTests(TestCase):
    """Tests for appcore.modules.beartype.beartype."""

    @patch(f"{_BEARTYPE_MODULE}.settings")
    @patch(f"{_BEARTYPE_MODULE}._beartype")
    def test_returns_original_function_when_typechecks_disabled(self, mock_beartype_impl, mock_settings):
        """
        GIVEN runtime type checks are disabled in settings
        WHEN beartype wrapper is applied to a function
        THEN it returns the original function without delegating to beartype
        """
        mock_settings.DISABLE_RUNTIME_TYPECHECKS = True

        wrapped = beartype(_sample_function)

        self.assertIs(wrapped, _sample_function)
        mock_beartype_impl.assert_not_called()

    @patch(f"{_BEARTYPE_MODULE}.settings")
    @patch(f"{_BEARTYPE_MODULE}._beartype")
    def test_delegates_to_beartype_when_typechecks_enabled(self, mock_beartype_impl, mock_settings):
        """
        GIVEN runtime type checks are enabled in settings
        WHEN beartype wrapper is applied to a function
        THEN it delegates to beartype implementation and returns its wrapped function
        """
        mock_settings.DISABLE_RUNTIME_TYPECHECKS = False

        def wrapped_impl(value: int) -> int:
            return value

        mock_beartype_impl.return_value = wrapped_impl

        wrapped = beartype(_sample_function)

        mock_beartype_impl.assert_called_once_with(_sample_function)
        self.assertIs(wrapped, wrapped_impl)


class RedisClientTests(TestCase):
    """Tests for appcore.modules.redis_client.get_redis."""

    def tearDown(self):
        get_redis.cache_clear()

    @patch(f"{_REDIS_MODULE}.APP_SETTINGS")
    @patch(f"{_REDIS_MODULE}.redis.Redis.from_url")
    def test_builds_redis_client_from_settings_url(self, mock_from_url, mock_settings):
        """
        GIVEN a configured Redis URL in application settings
        WHEN get_redis is called
        THEN it creates the client via redis.Redis.from_url with decode_responses enabled
        """
        mock_settings.REDIS_URL = "redis://localhost:6379/0"

        client = get_redis()

        mock_from_url.assert_called_once_with("redis://localhost:6379/0", decode_responses=True)
        self.assertIs(client, mock_from_url.return_value)

    @patch(f"{_REDIS_MODULE}.APP_SETTINGS")
    @patch(f"{_REDIS_MODULE}.redis.Redis.from_url")
    def test_returns_cached_client_on_subsequent_calls(self, mock_from_url, mock_settings):
        """
        GIVEN get_redis has already created a Redis client
        WHEN get_redis is called again
        THEN it returns the cached client and does not re-create it
        """
        mock_settings.REDIS_URL = "redis://localhost:6379/0"

        first = get_redis()
        second = get_redis()

        self.assertIs(first, second)
        mock_from_url.assert_called_once()
