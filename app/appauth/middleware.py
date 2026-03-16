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

from secrets import compare_digest
from typing import Callable

from django.http import HttpRequest, JsonResponse


class CookieAuthCSRFMiddleware:
    access_cookie_name = "backend_access_token"
    csrf_cookie_name = "backend_csrf_token"
    csrf_header_name = "X-Backend-CSRF"
    unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}

    def __init__(self, get_response: Callable[[HttpRequest], JsonResponse]):
        """
        Initialize the middleware with the given response handler.

        Args:
            get_response (Callable[[HttpRequest], JsonResponse]): A callable that takes
                an HttpRequest object and returns a JsonResponse object. This is the
                next middleware or view in the Django request/response cycle.
        """
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> JsonResponse:
        """
        Handle incoming HTTP requests with CSRF validation for unsafe methods.

        This method intercepts HTTP requests and applies CSRF protection for unsafe
        HTTP methods (e.g., POST, PUT, PATCH, DELETE). It bypasses CSRF validation
        for safe methods and Bearer token authenticated requests.

        Args:
            request (HttpRequest): The incoming HTTP request object.

        Returns:
            JsonResponse: Either the response from the next middleware/view in the
                chain, or a 403 JsonResponse if CSRF validation fails.

        Notes:
            - Safe HTTP methods bypass CSRF validation entirely.
            - Requests using Bearer token authentication bypass CSRF validation.
            - For unsafe methods, both the CSRF cookie and CSRF header must be
              present and must match (using constant-time comparison) to pass
              validation.
            - If CSRF validation fails, returns a 403 response with detail message.

        Raises:
            No explicit exceptions are raised; failures return a 403 JsonResponse.
        """
        if request.method not in self.unsafe_methods:
            return self.get_response(request)

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return self.get_response(request)

        access_cookie = request.COOKIES.get(self.access_cookie_name)
        if not access_cookie:
            return self.get_response(request)

        csrf_cookie = request.COOKIES.get(self.csrf_cookie_name)
        csrf_header = request.headers.get(self.csrf_header_name, "")

        if not csrf_cookie or not csrf_header or not compare_digest(csrf_cookie, csrf_header):
            return JsonResponse({"detail": "CSRF validation failed"}, status=403)

        return self.get_response(request)
