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

from typing import Callable, ParamSpec, TypeVar

from beartype import beartype as _beartype
from django.conf import settings

P = ParamSpec("P")
R = TypeVar("R")


def beartype(func: Callable[P, R]) -> Callable[P, R]:
    if settings.DISABLE_RUNTIME_TYPECHECKS:
        return func
    return _beartype(func)
