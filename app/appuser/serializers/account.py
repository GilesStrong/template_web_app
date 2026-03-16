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

from uuid import UUID

from ninja import Field, Schema




class ExportUserOut(Schema):
    id: UUID = Field(..., description='The unique ID of the user account')
    google_id: str = Field(..., description='Google account ID associated with this user')
    verified: bool = Field(..., description='Whether the user has a verified account')


class ExportDataOut(Schema):
    exported_at: str = Field(..., description='Export generation datetime in ISO 8601 format')
    user: ExportUserOut = Field(..., description='The user profile data')


class DeleteAccountRequestOut(Schema):
    confirmation_token: str = Field(..., description='Short-lived token required to confirm account deletion')
    expires_in_seconds: int = Field(..., description='Number of seconds before the confirmation token expires')


class DeleteAccountIn(Schema):
    confirmation_token: str = Field(..., description='Short-lived confirmation token from delete-request endpoint')
