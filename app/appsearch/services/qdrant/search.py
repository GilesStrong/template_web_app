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
from appcore.modules.beartype import beartype
from qdrant_client.http import models as qm

from appsearch.services.qdrant.client import QDRANT_CLIENT


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
