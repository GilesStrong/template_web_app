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

import os
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


type ENV = Literal['development', 'staging', 'production']


class EnvSettings(BaseSettings):
    DEBUG: bool
    ENVIRONMENT: ENV
    LOCALITY: str


class RedisSettings(BaseSettings):
    REDIS_URL: str


class DjangoSettings(BaseSettings):
    SECRET_KEY: str
    DEBUG: bool
    ALLOWED_HOSTS: list[str]
    CSRF_TRUSTED_ORIGINS: list[str]


class SecuritySettings(BaseSettings):
    SECURE_HSTS_SECONDS: int | None = None
    SECURE_HSTS_INCLUDE_SUBDOMAINS: bool | None = False
    SECURE_HSTS_PRELOAD: bool | None = None
    SESSION_COOKIE_HTTPONLY: bool = True
    SESSION_COOKIE_SAMESITE: Literal['Lax', 'Strict', 'None'] = 'Lax'
    CSRF_COOKIE_HTTPONLY: bool = False  # We have our own middleware
    CSRF_COOKIE_SAMESITE: Literal['Lax', 'Strict', 'None'] = 'Lax'
    SECURE_CONTENT_TYPE_NOSNIFF: bool = True
    SECURE_REFERRER_POLICY: str = 'strict-origin-when-cross-origin'
    X_FRAME_OPTIONS: Literal['DENY', 'SAMEORIGIN'] = 'DENY'


class CelerySettings(BaseSettings):
    CELERY_BROKER_URL: str
    CELERY_RESULT_BACKEND: str
    CELERY_TASK_DEFAULT_QUEUE: str
    CELERY_TASK_DEFAULT_EXCHANGE: str
    CELERY_TASK_DEFAULT_ROUTING_KEY: str
    CELERY_TASK_CREATE_MISSING_QUEUES: bool



class PostgresSettings(BaseSettings):
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_HOST: str
    POSTGRES_PORT: int


class QdrantSettings(BaseSettings):
    QDRANT_URL: str
    HNSW_M: int
    HNSW_EF_CONSTRUCT: int
    HNSW_EF_SEARCH: int


class LogfireSettings(BaseSettings):
    LOGFIRE_TOKEN: str
    LOGFIRE_ENVIRONMENT: str


class GoogleAuthSettings(BaseSettings):
    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str
    GOOGLE_ENFORCE_ALLOWED_EMAILS: bool
    GOOGLE_ALLOWED_EMAILS: list[str]


class AuthSettings(BaseSettings):
    JWT_ISSUER: str
    JWT_AUDIENCE: str
    JWT_SIGNING_KEY: str
    ACCESS_TOKEN_TTL_SECONDS: int
    REFRESH_TOKEN_TTL_SECONDS: int
    AUTH_EXCHANGE_PER_MINUTE: int = 20
    AUTH_REFRESH_PER_MINUTE: int = 60
    AUTH_RATE_LIMIT_FAIL_OPEN: bool = False
    AUTH_RATE_LIMIT_TRUSTED_PROXY_CIDRS: list[str] = []
    ADMIN_ALLOWLIST_CIDRS: str = ""


class CaddySettings(BaseSettings):
    PORT: int


class AppSettings(
    GoogleAuthSettings,
    EnvSettings,
    DjangoSettings,
    SecuritySettings,
    CelerySettings,
    PostgresSettings,
    QdrantSettings,
    LogfireSettings,
    AuthSettings,
    RedisSettings,
    CaddySettings,
):
    model_config = SettingsConfigDict(env_file_encoding='utf-8')


def _find_named_env_file(filename: str) -> Path | None:
    current_dir = BASE_DIR
    for _ in range(5):
        env_file_path = current_dir / filename
        if env_file_path.is_file():
            return env_file_path
        current_dir = current_dir.parent
    return None


def find_env_file() -> Path | None:
    return _find_named_env_file('.env')


def find_tests_env_file() -> Path | None:
    return _find_named_env_file('.env.tests')


def _resolve_custom_env_file(path_value: str) -> Path | None:
    candidate = Path(path_value)
    if candidate.is_absolute() and candidate.is_file():
        return candidate

    candidates = [
        Path.cwd() / candidate,
        BASE_DIR / candidate,
        BASE_DIR.parent / candidate,
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


def get_app_settings() -> AppSettings:
    custom_env_file = os.getenv("APP_ENV_FILE")
    if custom_env_file:
        env_file_path = _resolve_custom_env_file(custom_env_file)
        if env_file_path:
            return AppSettings(_env_file=env_file_path)  # type: ignore[call-arg]

    is_testing = "pytest" in sys.modules or "test" in sys.argv
    env_file_path = find_tests_env_file() if is_testing else find_env_file()
    if env_file_path is None:
        env_file_path = find_env_file()

    if env_file_path:
        return AppSettings(_env_file=env_file_path)  # type: ignore[call-arg]
    else:
        print("Warning: no env file found (.env.tests/.env). Using default environment variables.")
        return AppSettings()  # type: ignore[call-arg]


APP_SETTINGS = get_app_settings()
