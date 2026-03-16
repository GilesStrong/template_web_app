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

from django.test import TestCase

from appsearch.services.qdrant.search_dsl import (
    Filter,
    MatchAnyCondition,
    MatchValueCondition,
    Query,
    RangeCondition,
)


class RangeConditionTests(TestCase):
    """Tests for RangeCondition."""

    def test_raises_when_gte_greater_than_lte(self):
        """
        GIVEN a range condition where gte is greater than lte
        WHEN RangeCondition is validated
        THEN it raises a ValueError for invalid bounds
        """
        with self.assertRaises(ValueError):
            RangeCondition(key="cmc", gte=6, lte=2)

    def test_to_qdrant_maps_bounds_and_key(self):
        """
        GIVEN a valid numeric range condition
        WHEN to_qdrant is called
        THEN it returns a FieldCondition with matching key and range bounds
        """
        cond = RangeCondition(key="cmc", gte=1, lte=4)

        result = cond.to_qdrant()

        self.assertEqual(result.key, "cmc")
        self.assertEqual(result.range.gte, 1)
        self.assertEqual(result.range.lte, 4)


class MatchConditionTests(TestCase):
    """Tests for match condition models."""

    def test_match_any_rejects_empty_list(self):
        """
        GIVEN a match-any condition with an empty value list
        WHEN MatchAnyCondition is validated
        THEN it raises a ValueError
        """
        with self.assertRaises(ValueError):
            MatchAnyCondition(key="colors", any=[])

    def test_match_value_to_qdrant_contains_value(self):
        """
        GIVEN a match-value condition
        WHEN to_qdrant is called
        THEN it maps key and value into a Qdrant FieldCondition
        """
        cond = MatchValueCondition(key="rarity", value="common")

        result = cond.to_qdrant()

        self.assertEqual(result.key, "rarity")
        self.assertEqual(result.match.value, "common")


class FilterAndQueryTests(TestCase):
    """Tests for Filter and Query models."""

    def test_filter_to_qdrant_builds_must_should_must_not(self):
        """
        GIVEN a filter with should, must, and must_not conditions
        WHEN to_qdrant is called
        THEN it returns a Qdrant filter with all condition groups populated
        """
        dsl_filter = Filter(
            min_should_count=1,
            should=[MatchAnyCondition(key="colors", any=["R", "U"])],
            must=[RangeCondition(key="converted_mana_cost", gte=1, lte=3)],
            must_not=[MatchValueCondition(key="rarity", value="mythic")],
        )

        q_filter = dsl_filter.to_qdrant()

        self.assertIsNotNone(q_filter.min_should)
        self.assertEqual(q_filter.min_should.min_count, 1)
        self.assertEqual(len(q_filter.must), 1)
        self.assertEqual(len(q_filter.must_not), 1)

    def test_query_requires_query_string_or_filter(self):
        """
        GIVEN a query without query_string and without filter
        WHEN Query is validated
        THEN it raises a ValueError because at least one input is required
        """
        with self.assertRaises(ValueError):
            Query(collection_name="cards", query_string=None, filter=None, limit=10)

    def test_query_accepts_filter_only(self):
        """
        GIVEN a query with no query_string but with a filter
        WHEN Query is validated
        THEN it succeeds as a valid filter-only query
        """
        query = Query(
            collection_name="cards",
            query_string=None,
            filter=Filter(must=[MatchValueCondition(key="rarity", value="common")]),
            limit=5,
        )

        self.assertEqual(query.collection_name, "cards")
        self.assertIsNone(query.query_string)
        self.assertEqual(query.limit, 5)
