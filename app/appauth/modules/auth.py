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

from typing import Any, cast

from appuser.models.user import User
from django.http import HttpRequest


def get_user_from_request(request: HttpRequest) -> User:
    """
    Retrieves the authenticated user from an HTTP request object.

    Args:
        request (HttpRequest): The HTTP request object containing authentication information.

    Returns:
        User: The authenticated user extracted from the request's auth attribute.
    """
    try:
        return cast(Any, request).auth
    except AttributeError:
        raise ValueError("Request object does not have an 'auth' attribute or it is not set.")
