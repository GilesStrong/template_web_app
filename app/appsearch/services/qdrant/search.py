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

from typing import Optional

import logfire
from app.app_settings import APP_SETTINGS
from appai.modules.dense_embedding import dense_embed
from appcore.modules.beartype import beartype
from qdrant_client.http import models as qm

from appsearch.services.qdrant.client import QDRANT_CLIENT
from appsearch.services.qdrant.search_dsl import Query as DSLQuery


@beartype
def run_query(
    collection_name: str,
    query_vector: Optional[list[float]],
    query_filter: Optional[qm.Filter],
    limit: int = 10,
) -> list[qm.ScoredPoint]:
    """
    Execute a vector similarity search query against a Qdrant collection.

    Args:
        collection_name (str): The name of the Qdrant collection to query.
        query_vector (Optional[list[float]]): The vector to use for similarity search.
            If None, the query will be performed without vector similarity.
        query_filter (Optional[qm.Filter]): Optional Qdrant filter to apply to the query,
            allowing to narrow down results based on payload conditions.
        limit (int, optional): Maximum number of results to return. Defaults to 10.

    Returns:
        list[qm.ScoredPoint]: A list of scored points from the Qdrant collection,
            each containing the point's ID, score, and payload. Vectors are not included
            in the returned results.
    """
    log_message = f"Running query on collection '{collection_name}' with limit {limit}"
    if query_filter:
        log_message += f", using query_filter: {query_filter.model_dump_json(indent=2, ensure_ascii=False)}"
    else:
        log_message += ", with no query_filter"
    if query_vector:
        log_message += ", using query_vector"
    else:
        log_message += ", with no query_vector"
    logfire.info(log_message)
    res = QDRANT_CLIENT.query_points(
        collection_name=collection_name,
        query=query_vector,
        using="dense",
        query_filter=query_filter,
        search_params=qm.SearchParams(hnsw_ef=APP_SETTINGS.HNSW_EF_SEARCH),
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    return res.points


@beartype
def run_query_from_dsl(
    dsl_query: DSLQuery, exclude_ids: Optional[list[str]] = None, include_ids: Optional[list[str]] = None
) -> list[qm.ScoredPoint]:
    """
    Execute a Qdrant search query from a DSL (Domain Specific Language) query object.

    This function converts a DSLQuery object into a Qdrant search query, handling
    vector embedding, filter construction, and optional inclusion/exclusion of
    specific document IDs.

    Args:
        dsl_query (DSLQuery): The DSL query object containing:
            - query_string: Optional text to be converted to a dense vector embedding
            - filter: Optional filter conditions to apply to the search
            - collection_name: The name of the Qdrant collection to search
            - limit: Maximum number of results to return
        exclude_ids (Optional[list[str]]): List of document IDs to exclude from
            search results. Defaults to None.
        include_ids (Optional[list[str]]): List of document IDs that must be
            included in search results. Defaults to None.

    Returns:
        list[qm.ScoredPoint]: A list of scored points from the Qdrant search,
            ordered by relevance score.
    """
    query_vector = dense_embed(dsl_query.query_string) if dsl_query.query_string else None
    query_filter = dsl_query.filter.to_qdrant() if dsl_query.filter else None

    must_not = [qm.HasIdCondition(has_id=exclude_ids)] if exclude_ids else []  # type: ignore [arg-type]
    must = [qm.HasIdCondition(has_id=include_ids)] if include_ids else []  # type: ignore [arg-type]
    if query_filter:
        if query_filter.must:
            if isinstance(query_filter.must, list):
                query_filter.must.extend(must)
            else:
                query_filter.must = [query_filter.must] + must  # type: ignore [operator]
        else:
            query_filter.must = must  # type: ignore [assignment]
        if query_filter.must_not:
            if isinstance(query_filter.must_not, list):
                query_filter.must_not.extend(must_not)
            else:
                query_filter.must_not = [query_filter.must_not] + must_not  # type: ignore [operator]
        else:
            query_filter.must_not = must_not  # type: ignore [assignment]
    elif must or must_not:
        query_filter = qm.Filter(must=must if must else None, must_not=must_not if must_not else None)  # type: ignore [arg-type]

    return run_query(
        collection_name=dsl_query.collection_name,
        query_vector=query_vector,
        query_filter=query_filter,
        limit=dsl_query.limit,
    )
