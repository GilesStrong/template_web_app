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

from app.app_settings import APP_SETTINGS
from appcore.modules.beartype import beartype
from qdrant_client.http import models as qm

from appsearch.services.qdrant.client import QDRANT_CLIENT


@beartype
def create_collection_if_not_exists(collection_name: str) -> None:
    if collection_name not in [c.name for c in QDRANT_CLIENT.get_collections().collections]:
        print(f"Creating Qdrant collection: {collection_name}")
        QDRANT_CLIENT.create_collection(
            collection_name=collection_name,
            vectors_config={
                "dense": qm.VectorParams(
                    size=APP_SETTINGS.EMBEDDING_DIMENSION,
                    distance=qm.Distance.COSINE,
                    hnsw_config=qm.HnswConfigDiff(
                        m=APP_SETTINGS.HNSW_M,
                        ef_construct=APP_SETTINGS.HNSW_EF_CONSTRUCT,
                    ),
                )
            },
        )


@beartype
def upsert_documents(collection_name: str, points: list[qm.PointStruct]) -> None:
    QDRANT_CLIENT.upsert(
        collection_name=collection_name,
        points=points,
    )
