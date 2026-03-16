/*
Copyright 2026 Giles Strong

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2 } from "lucide-react";
import { backendFetch, clearBackendTokens, ensureBackendTokens } from "@/lib/backend-auth";
import { getAvatarUrlFromSession } from "@/lib/avatar";

type DeckSummary = {
    id: string;
    name: string;
    short_summary: string | null;
    set_codes: string[];
    tags?: string[];
    date_updated: string;
    generation_status: string | null;
    generation_task_id: string | null;
    n_cards_so_far?: number | null;
    n_searches_so_far?: number | null;
    n_replacements_so_far?: number | null;
    n_replacements_total?: number | null;
};

const DEFAULT_POLLABLE_STATUSES = new Set([
    "PENDING",
    "IN_PROGRESS",
    "BUILDING_DECK",
    "CLASSIFYING_DECK_CARDS",
    "FINDING_REPLACEMENT_CARDS",
]);

type BuildStatusesResponse = {
    all: string[];
    pollable: string[];
};

type BuildStatusResponse = {
    status: string;
    deck_id: string;
    n_cards_so_far?: number | null;
    n_searches_so_far?: number | null;
    n_replacements_so_far?: number | null;
    n_replacements_total?: number | null;
};

const parseApiError = async (response: Response, fallbackMessage: string): Promise<string> => {
    const responseText = await response.text();
    if (!responseText) {
        return `${fallbackMessage} (HTTP ${response.status})`;
    }

    try {
        const data = JSON.parse(responseText) as {
            detail?: string;
            message?: string;
            error?: string;
        };

        const detail = data.detail ?? data.message ?? data.error;
        if (detail) {
            return `${fallbackMessage} (HTTP ${response.status}): ${detail}`;
        }
    } catch {
        // fall through to raw text
    }

    return `${fallbackMessage} (HTTP ${response.status}): ${responseText.trim()}`;
};

export default function DashboardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [decks, setDecks] = useState<DeckSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [availableSetCodes, setAvailableSetCodes] = useState<string[]>([]);
    const [selectedSetCodes, setSelectedSetCodes] = useState<string[]>([]);
    const [selectedDeckTags, setSelectedDeckTags] = useState<string[]>([]);
    const [isLoadingSetCodes, setIsLoadingSetCodes] = useState(true);
    const [pollableStatuses, setPollableStatuses] = useState<Set<string>>(new Set(DEFAULT_POLLABLE_STATUSES));
    const [isBackendReady, setIsBackendReady] = useState(false);

    useEffect(() => {
        if (status !== "authenticated") {
            setIsBackendReady(false);
            setIsLoading(true);
            setIsLoadingSetCodes(true);
            return;
        }

        const syncBackendTokens = async () => {
            setIsLoading(true);
            setIsLoadingSetCodes(true);

            try {
                await ensureBackendTokens(session);
                setIsBackendReady(true);
            } catch (error) {
                console.error("Error syncing backend tokens for dashboard:", error);
                setIsBackendReady(false);
                setIsLoading(false);
                setIsLoadingSetCodes(false);
            }
        };

        void syncBackendTokens();
    }, [session, status]);

    const fetchDecks = useCallback(async () => {
        const response = await backendFetch(session, "/api/app/cards/deck/");

        if (!response.ok) {
            throw new Error(await parseApiError(response, "Failed to fetch deck summaries"));
        }

        const data = (await response.json()) as DeckSummary[];
        setDecks((currentDecks) =>
            data.map((deck) => {
                const currentDeck = currentDecks.find((item) => item.id === deck.id);
                if (!currentDeck) {
                    return deck;
                }

                return {
                    ...deck,
                    n_cards_so_far: currentDeck.n_cards_so_far,
                    n_searches_so_far: currentDeck.n_searches_so_far,
                    n_replacements_so_far: currentDeck.n_replacements_so_far,
                    n_replacements_total: currentDeck.n_replacements_total,
                };
            })
        );
    }, [session]);

    useEffect(() => {
        const loadPollableStatuses = async () => {
            try {
                const response = await backendFetch(session, "/api/app/ai/deck/statuses/");
                if (!response.ok) {
                    throw new Error(await parseApiError(response, "Failed to fetch deck build statuses"));
                }

                const data = (await response.json()) as BuildStatusesResponse;
                if (Array.isArray(data.pollable) && data.pollable.length > 0) {
                    setPollableStatuses(new Set(data.pollable));
                    return;
                }
            } catch (error) {
                console.error("Error loading deck build statuses:", error);
            }

            setPollableStatuses(new Set(DEFAULT_POLLABLE_STATUSES));
        };

        if (status !== "authenticated" || !isBackendReady) {
            return;
        }

        void loadPollableStatuses();
    }, [isBackendReady, session, status]);

    useEffect(() => {
        const loadSetCodes = async () => {
            try {
                const response = await backendFetch(session, "/api/app/cards/card/set_codes/");
                if (!response.ok) {
                    throw new Error(await parseApiError(response, "Failed to fetch set codes"));
                }

                const data = (await response.json()) as { set_codes: string[] };
                const sortedCodes = [...data.set_codes].sort((a, b) => a.localeCompare(b));
                setAvailableSetCodes(sortedCodes);
            } catch (error) {
                console.error("Error loading set codes:", error);
                setAvailableSetCodes([]);
            } finally {
                setIsLoadingSetCodes(false);
            }
        };

        if (status !== "authenticated" || !isBackendReady) {
            return;
        }

        void loadSetCodes();
    }, [isBackendReady, session, status]);

    useEffect(() => {
        if (status !== "authenticated" || !isBackendReady) {
            return;
        }

        const load = async () => {
            try {
                await fetchDecks();
            } catch (error) {
                console.error("Error loading decks:", error);
            } finally {
                setIsLoading(false);
            }
        };

        void load();
    }, [fetchDecks, isBackendReady, status]);

    const activeDecks = useMemo(
        () =>
            decks.filter(
                (deck) =>
                    deck.generation_status &&
                    pollableStatuses.has(deck.generation_status) &&
                    Boolean(deck.generation_task_id)
            ),
        [decks, pollableStatuses]
    );

    useEffect(() => {
        if (activeDecks.length === 0) {
            return;
        }

        const interval = setInterval(async () => {
            try {
                await Promise.all(
                    activeDecks.map(async (deck) => {
                        if (!deck.generation_task_id) {
                            return;
                        }

                        const statusResponse = await backendFetch(
                            session,
                            `/api/app/ai/deck/build_status/${deck.generation_task_id}/`
                        );
                        if (!statusResponse.ok) {
                            return;
                        }

                        const statusData = (await statusResponse.json()) as BuildStatusResponse;
                        setDecks((current) =>
                            current.map((item) =>
                                item.id === statusData.deck_id
                                    ? {
                                        ...item,
                                        generation_status: statusData.status,
                                        n_cards_so_far: statusData.n_cards_so_far ?? null,
                                        n_searches_so_far: statusData.n_searches_so_far ?? null,
                                        n_replacements_so_far: statusData.n_replacements_so_far ?? null,
                                        n_replacements_total: statusData.n_replacements_total ?? null,
                                    }
                                    : item
                            )
                        );
                    })
                );

                await fetchDecks();
            } catch (error) {
                console.error("Error polling deck statuses:", error);
            }
        }, 2500);

        return () => clearInterval(interval);
    }, [activeDecks, fetchDecks, session]);

    const handleSignOut = async () => {
        try {
            await clearBackendTokens();
        } finally {
            await signOut({ callbackUrl: "/login" });
        }
    };

    const userInitials =
        session?.user?.name
            ?.split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase() || "U";
    const avatarUrl = getAvatarUrlFromSession(session);

    const toggleSetCode = (code: string) => {
        setSelectedSetCodes((current) =>
            current.includes(code) ? current.filter((value) => value !== code) : [...current, code]
        );
    };

    const toggleDeckTag = (tag: string) => {
        setSelectedDeckTags((current) =>
            current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
        );
    };

    const availableDeckTags = useMemo(
        () =>
            Array.from(new Set(decks.flatMap((deck) => deck.tags ?? []))).sort((a, b) => a.localeCompare(b)),
        [decks]
    );

    const filteredDecks = useMemo(() => {
        return decks.filter((deck) => {
            const matchesSetCodes =
                selectedSetCodes.length === 0 || deck.set_codes.some((code) => selectedSetCodes.includes(code));
            const matchesDeckTags =
                selectedDeckTags.length === 0 || (deck.tags ?? []).some((tag) => selectedDeckTags.includes(tag));

            return matchesSetCodes && matchesDeckTags;
        });
    }, [decks, selectedDeckTags, selectedSetCodes]);

    return (
        <div className="flex-1 bg-gradient-to-br from-slate-50 to-slate-100">
            <header className="border-b bg-white/80 backdrop-blur-sm">
                <div className="container mx-auto flex items-center justify-between px-4 py-4">
                    <h1 className="text-2xl font-bold">Deep MTG</h1>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground">{session?.user?.email}</span>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                                    <Avatar>
                                        <AvatarImage src={avatarUrl} />
                                        <AvatarFallback>{userInitials}</AvatarFallback>
                                    </Avatar>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>{session?.user?.name}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>Account</DropdownMenuItem>
                                <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                <div className="mx-auto max-w-4xl space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold">Decks</h2>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => router.push("/cards/search")}>Search Cards</Button>
                            <Button onClick={() => router.push("/decks/generate")}>Generate Deck</Button>
                        </div>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Filters</CardTitle>
                            <CardDescription>
                                Filter decks by set codes and tags. Multiple selections within a filter use OR matching.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Set Codes</Label>
                                {isLoadingSetCodes ? (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading set codes...
                                    </div>
                                ) : availableSetCodes.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No set codes available.</p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap gap-2">
                                            {availableSetCodes.map((code) => {
                                                const isSelected = selectedSetCodes.includes(code);

                                                return (
                                                    <Button
                                                        key={code}
                                                        type="button"
                                                        size="sm"
                                                        variant={isSelected ? "default" : "outline"}
                                                        onClick={() => toggleSetCode(code)}
                                                    >
                                                        {code}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {selectedSetCodes.length === 0
                                                ? "No set-code filter active."
                                                : `Set-code filter active: ${selectedSetCodes.length} selected.`}
                                        </p>
                                    </>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label>Deck Tags</Label>
                                {availableDeckTags.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No deck tags available.</p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap gap-2">
                                            {availableDeckTags.map((tag) => {
                                                const isSelected = selectedDeckTags.includes(tag);

                                                return (
                                                    <Button
                                                        key={tag}
                                                        type="button"
                                                        size="sm"
                                                        variant={isSelected ? "default" : "outline"}
                                                        onClick={() => toggleDeckTag(tag)}
                                                    >
                                                        {tag}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {selectedDeckTags.length === 0
                                                ? "No tag filter active."
                                                : `Tag filter active: ${selectedDeckTags.length} tag${selectedDeckTags.length === 1 ? "" : "s"} selected (OR matching).`}
                                        </p>
                                    </>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {isLoading ? (
                        <Card>
                            <CardContent className="flex items-center justify-center py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </CardContent>
                        </Card>
                    ) : null}

                    {!isLoading && filteredDecks.length === 0 ? (
                        <Card>
                            <CardHeader>
                                <CardTitle>No decks found</CardTitle>
                                <CardDescription>
                                    {decks.length === 0 ? (
                                        <>
                                            Welcome to Deep MTG! Use card search to find inspiration, and the deck builder to get started on your collection.
                                        </>
                                    ) : (
                                        "Try adjusting your set code filter."
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {decks.length === 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="outline" onClick={() => router.push("/cards/search")}>
                                            Open Card Search
                                        </Button>
                                        <Button onClick={() => router.push("/decks/generate")}>Open Deck Builder</Button>
                                    </div>
                                ) : (
                                    <Button
                                        onClick={() => {
                                            setSelectedSetCodes([]);
                                            setSelectedDeckTags([]);
                                        }}
                                        variant="outline"
                                    >
                                        Clear Filters
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    ) : null}

                    {!isLoading
                        ? filteredDecks.map((deck) => (
                            <Card
                                key={deck.id}
                                className="cursor-pointer transition-colors hover:bg-secondary/20"
                                onClick={() =>
                                    router.push(
                                        deck.generation_task_id
                                            ? `/decks/${deck.id}?taskId=${deck.generation_task_id}`
                                            : `/decks/${deck.id}`
                                    )
                                }
                            >
                                <CardHeader>
                                    <CardTitle className="text-xl">{deck.name}</CardTitle>
                                    <CardDescription>
                                        Status: {deck.generation_status ?? "UNKNOWN"} • Updated: {new Date(deck.date_updated).toISOString()}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {deck.generation_status === "BUILDING_DECK" ? (
                                        <p className="text-xs text-muted-foreground">
                                            Build progress: {deck.n_cards_so_far ?? 0} cards • {deck.n_searches_so_far ?? 0} searches
                                        </p>
                                    ) : null}
                                    {deck.generation_status === "FINDING_REPLACEMENT_CARDS" ? (
                                        <p className="text-xs text-muted-foreground">
                                            Replacement progress: {deck.n_replacements_so_far ?? 0}/{deck.n_replacements_total ?? "?"}
                                        </p>
                                    ) : null}
                                    <p className="text-sm text-muted-foreground">
                                        {deck.short_summary ?? "No summary available yet."}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Tags: {(deck.tags ?? []).length > 0 ? (deck.tags ?? []).join(", ") : "None"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Sets: {deck.set_codes.length > 0 ? deck.set_codes.join(", ") : "None"}
                                    </p>
                                </CardContent>
                            </Card>
                        ))
                        : null}
                </div>
            </main>
        </div>
    );
}
