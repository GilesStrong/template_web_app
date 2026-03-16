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

from contextlib import contextmanager
from contextvars import ContextVar

from celery import current_task

_IN_CELERY_TASK_CONTEXT: ContextVar[bool] = ContextVar("in_celery_task_context", default=False)


@contextmanager
def celery_task_context():  # type: ignore [no-untyped-def]
    """
    A context manager that sets the Celery task context flag for the duration of the block.

    This context manager uses a ContextVar to indicate that the current execution
    is happening within a Celery task context. It ensures the flag is properly
    reset to its previous value after the block exits, even if an exception occurs.

    Yields:
        None

    Example:
        >>> with celery_task_context():
        ...     # Code here will execute within a Celery task context
        ...     pass
    """
    token = _IN_CELERY_TASK_CONTEXT.set(True)
    try:
        yield
    finally:
        _IN_CELERY_TASK_CONTEXT.reset(token)


def in_celery_task() -> bool:
    """
    Determines whether the current execution context is within a Celery task.

    Checks both a context variable (_IN_CELERY_TASK_CONTEXT) and the current
    Celery task's request ID to determine if code is running inside a Celery task.

    Returns:
        bool: True if the current code is executing within a Celery task context,
              False otherwise.
    """
    return bool(_IN_CELERY_TASK_CONTEXT.get() or (current_task and current_task.request and current_task.request.id))
