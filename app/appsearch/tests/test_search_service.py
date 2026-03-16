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
from qdrant_client.http import models as qm

from appsearch.services.qdrant.search import run_query, run_query_from_dsl
from appsearch.services.qdrant.search_dsl import Filter, MatchValueCondition, Query

_MODULE = "appsearch.services.qdrant.search"


class RunQueryTests(TestCase):
    """Tests for run_query."""

    @patch(f"{_MODULE}.APP_SETTINGS")
    @patch(f"{_MODULE}.QDRANT_CLIENT")
    def test_calls_query_points_and_returns_points(self, mock_client, mock_settings):
        """
        GIVEN query inputs and configured HNSW search setting
        WHEN run_query is called
        THEN it calls Qdrant query_points and returns its points list
        """
        mock_settings.HNSW_EF_SEARCH = 64
        expected_points = [SimpleNamespace(id="1"), SimpleNamespace(id="2")]
        mock_client.query_points.return_value = SimpleNamespace(points=expected_points)

        result = run_query("cards", [0.1, 0.2], None, limit=7)

        mock_client.query_points.assert_called_once()
        self.assertEqual(result, expected_points)


class RunQueryFromDslTests(TestCase):
    """Tests for run_query_from_dsl."""

    @patch(f"{_MODULE}.run_query")
    @patch(f"{_MODULE}.dense_embed")
    def test_builds_vector_from_query_string_and_runs_query(self, mock_dense_embed, mock_run_query):
        """
        GIVEN a DSL query with query_string and no filter
        WHEN run_query_from_dsl is called
        THEN it embeds the query string and forwards vector to run_query
        """
        mock_dense_embed.return_value = [0.3, 0.4, 0.5]
        mock_run_query.return_value = [SimpleNamespace(id="x")]
        dsl = Query(collection_name="cards", query_string="cheap removal", filter=None, limit=5)

        result = run_query_from_dsl(dsl)

        mock_dense_embed.assert_called_once_with("cheap removal")
        mock_run_query.assert_called_once_with(
            collection_name="cards",
            query_vector=[0.3, 0.4, 0.5],
            query_filter=None,
            limit=5,
        )
        self.assertEqual(result, [SimpleNamespace(id="x")])

    @patch(f"{_MODULE}.run_query")
    def test_merges_include_and_exclude_ids_into_filter(self, mock_run_query):
        """
        GIVEN a DSL query with a base filter plus include_ids and exclude_ids
        WHEN run_query_from_dsl is called
        THEN it augments must and must_not conditions with HasIdCondition filters
        """
        mock_run_query.return_value = []
        dsl_filter = Filter(must=[MatchValueCondition(key="rarity", value="common")])
        dsl = Query(collection_name="cards", query_string=None, filter=dsl_filter, limit=10)

        run_query_from_dsl(dsl_query=dsl, include_ids=["a", "b"], exclude_ids=["c"])

        called_filter: qm.Filter = mock_run_query.call_args.kwargs["query_filter"]
        self.assertIsNotNone(called_filter)
        self.assertTrue(any(isinstance(condition, qm.HasIdCondition) for condition in (called_filter.must or [])))
        self.assertTrue(any(isinstance(condition, qm.HasIdCondition) for condition in (called_filter.must_not or [])))

    @patch(f"{_MODULE}.run_query")
    def test_creates_filter_from_ids_when_no_dsl_filter(self, mock_run_query):
        """
        GIVEN a DSL query with no base filter but with include/exclude IDs
        WHEN run_query_from_dsl is called
        THEN it creates a new Qdrant filter containing ID constraints
        """
        mock_run_query.return_value = []
        dsl = Query(collection_name="cards", query_string=None, filter=Filter(), limit=3)

        run_query_from_dsl(dsl_query=dsl, include_ids=["x"], exclude_ids=["y"])

        called_filter: qm.Filter = mock_run_query.call_args.kwargs["query_filter"]
        self.assertIsNotNone(called_filter)
        self.assertEqual(len(called_filter.must or []), 1)
        self.assertEqual(len(called_filter.must_not or []), 1)
