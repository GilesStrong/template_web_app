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

from django.test import TestCase

from appsearch.services.qdrant.upsert import create_collection_if_not_exists, upsert_documents

_UPSERT_MODULE = "appsearch.services.qdrant.upsert"
_CLIENT_MODULE = "appsearch.services.qdrant.client"


class UpsertServiceTests(TestCase):
    """Tests for qdrant upsert helpers."""

    @patch(f"{_UPSERT_MODULE}.print")
    @patch(f"{_UPSERT_MODULE}.APP_SETTINGS")
    @patch(f"{_UPSERT_MODULE}.QDRANT_CLIENT")
    def test_create_collection_when_missing(self, mock_client, mock_settings, _mock_print):
        """
        GIVEN a collection name not present in Qdrant
        WHEN create_collection_if_not_exists is called
        THEN it creates the collection with configured vector parameters
        """
        mock_settings.EMBEDDING_DIMENSION = 1024
        mock_settings.HNSW_M = 32
        mock_settings.HNSW_EF_CONSTRUCT = 128
        mock_client.get_collections.return_value = SimpleNamespace(collections=[SimpleNamespace(name="other")])

        create_collection_if_not_exists("cards")

        mock_client.create_collection.assert_called_once()
        kwargs = mock_client.create_collection.call_args.kwargs
        self.assertEqual(kwargs["collection_name"], "cards")
        self.assertIn("dense", kwargs["vectors_config"])

    @patch(f"{_UPSERT_MODULE}.QDRANT_CLIENT")
    def test_does_not_create_collection_when_existing(self, mock_client):
        """
        GIVEN a collection name already present in Qdrant
        WHEN create_collection_if_not_exists is called
        THEN it does not call create_collection
        """
        mock_client.get_collections.return_value = SimpleNamespace(collections=[SimpleNamespace(name="cards")])

        create_collection_if_not_exists("cards")

        mock_client.create_collection.assert_not_called()

    @patch(f"{_UPSERT_MODULE}.QDRANT_CLIENT")
    def test_upsert_documents_calls_qdrant_upsert(self, mock_client):
        """
        GIVEN a collection name and list of points
        WHEN upsert_documents is called
        THEN it delegates to Qdrant upsert with same inputs
        """
        points = [SimpleNamespace(id="p1"), SimpleNamespace(id="p2")]

        upsert_documents("cards", points)

        mock_client.upsert.assert_called_once_with(collection_name="cards", points=points)


class QdrantClientModuleTests(TestCase):
    """Tests for qdrant client construction helper."""

    @patch(f"{_CLIENT_MODULE}.APP_SETTINGS")
    @patch(f"{_CLIENT_MODULE}.QdrantClient")
    def test_get_client_uses_configured_qdrant_url(self, mock_client_cls, mock_settings):
        """
        GIVEN a configured Qdrant URL in app settings
        WHEN _get_client is called
        THEN it constructs QdrantClient with that URL
        """
        from appsearch.services.qdrant.client import _get_client

        mock_settings.QDRANT_URL = "http://qdrant:6333"

        client = _get_client()

        mock_client_cls.assert_called_once_with(url="http://qdrant:6333")
        self.assertEqual(client, mock_client_cls.return_value)
