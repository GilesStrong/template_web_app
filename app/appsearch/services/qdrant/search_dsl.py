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

from typing import MutableSequence, Self

from pydantic import BaseModel, Field, field_validator, model_validator
from qdrant_client.http import models as qm


class RangeCondition(BaseModel):
    """
    Represents a range filter condition for numeric fields in Qdrant search queries.

    This model validates that a range condition has at least one boundary (gte or lte)
    and that the range is logically valid (lower bound <= upper bound).

    This will be treated as `qm.FieldCondition(key=key, range=qm.Range(lte=le, gte=gte))` when constructing the Qdrant query.
    """

    key: str = Field(..., description="Field name to apply the range condition on")
    gte: float = Field(..., description="Greater than or equal to")
    lte: float = Field(..., description="Less than or equal to")

    @model_validator(mode='after')
    def check_range(self) -> Self:
        if self.gte is None and self.lte is None:
            raise ValueError("At least one of gte or lte must be provided")
        if self.gte is not None and self.lte is not None and self.gte > self.lte:
            raise ValueError("Invalid range: gte must be less than or equal to lte")
        return self

    def to_qdrant(self) -> qm.FieldCondition:
        """
        Convert the range condition to a Qdrant FieldCondition with a range filter.

        This method constructs a Qdrant Range object from the instance's gte (greater than or equal)
        and lte (less than or equal) values, and wraps it in a FieldCondition for the specified key.

        Returns:
            qm.FieldCondition: A Qdrant FieldCondition object containing a Range filter with the
                specified bounds (gte and/or lte) applied to the field identified by self.key.
        """
        return qm.FieldCondition(key=self.key, range=qm.Range(gte=self.gte, lte=self.lte))


class MatchAnyCondition(BaseModel):
    """
    Represents a "match any" filter condition for string fields in Qdrant search queries.

    This class represents a filtering condition used in search queries where a document
    is considered a match if the specified field contains any of the values in the 'any' list.
    It performs an OR operation across all values in the list.

    This will be treated as `qm.FieldCondition(key=key, match=qm.MatchAny(any=any))` when constructing the Qdrant query.
    """

    key: str = Field(..., description="Field name to apply the match any condition on")
    any: list[str] = Field(..., description="List of values to match any of")

    @field_validator('any', mode='after')
    @classmethod
    def check_any(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("The 'any' list cannot be empty")
        return v

    def to_qdrant(self) -> qm.FieldCondition:
        """
        Convert the match any condition to a Qdrant FieldCondition with a MatchAny filter.

        This method constructs a Qdrant MatchAny object from the instance's 'any' list of values,
        and wraps it in a FieldCondition for the specified key.

        Returns:
            qm.FieldCondition: A Qdrant FieldCondition object containing a MatchAny filter with the
                specified list of values applied to the field identified by self.key.
        """
        return qm.FieldCondition(key=self.key, match=qm.MatchAny(any=self.any))


class MatchValueCondition(BaseModel):
    """
    Represents a "match value" filter condition for string, numeric, or boolean fields in Qdrant search queries.

    This will be treated as `qm.FieldCondition(key=key, match=qm.MatchValue(value=value))` when constructing the Qdrant query.
    """

    key: str = Field(..., description="Field name to apply the match value condition on")
    value: str | int | bool = Field(..., description="Value to match against the field")

    def to_qdrant(self) -> qm.FieldCondition:
        """
        Convert the match value condition to a Qdrant FieldCondition with a MatchValue filter.

        This method constructs a Qdrant MatchValue object from the instance's 'value',
        and wraps it in a FieldCondition for the specified key.

        Returns:
            qm.FieldCondition: A Qdrant FieldCondition object containing a MatchValue filter with the
                specified value applied to the field identified by self.key.
        """
        return qm.FieldCondition(key=self.key, match=qm.MatchValue(value=self.value))


type Condition = RangeCondition | MatchAnyCondition | MatchValueCondition


class Filter(BaseModel):
    min_should_count: int = Field(
        default=1,
        description="Minimum number of the 'should' conditions that must be satisfied (if any 'should' conditions are provided)",
    )
    should: MutableSequence[Condition] = Field(
        default_factory=list,
        description="List of conditions where at least `min_should` must be satisfied (logical OR)",
    )
    must: MutableSequence[Condition] = Field(
        default_factory=list, description="List of conditions that must all be satisfied (logical AND)"
    )
    must_not: MutableSequence[Condition] = Field(
        default_factory=list, description="List of conditions that must not be satisfied (logical NAND)"
    )

    def to_qdrant(self) -> qm.Filter:
        """
        Convert the Filter instance to a Qdrant Filter object.

        This method transforms the lists of RangeCondition, MatchAnyCondition, and MatchValueCondition
        instances in the 'should', 'must', and 'must_not' fields into corresponding lists of Qdrant
        FieldCondition objects. It then constructs a Qdrant Filter object using these lists and the
        specified 'min_should' value.

        Returns:
            qm.Filter: A Qdrant Filter object containing the converted conditions from this Filter instance.
        """
        return qm.Filter(
            min_should=qm.MinShould(
                min_count=self.min_should_count, conditions=[cond.to_qdrant() for cond in self.should]
            )
            if self.should
            else None,
            must=[cond.to_qdrant() for cond in self.must],
            must_not=[cond.to_qdrant() for cond in self.must_not],
        )


class Query(BaseModel):
    """
    Represents a search query for Qdrant, including the collection to query, the query string for vector search,
    optional filters, and the limit on the number of results to return.
    """

    collection_name: str = Field(..., description="Name of the Qdrant collection to query")
    query_string: str | None = Field(
        ..., description="Query string to embed and use for vector search (optional if using filters only)"
    )
    filter: Filter | None = Field(None, description="Optional filter to apply to the query")
    limit: int = Field(10, description="Maximum number of results to return")

    @model_validator(mode='after')
    def check_query(self) -> Self:
        if not self.query_string and not self.filter:
            raise ValueError("At least one of query_string or filter must be provided")
        return self
