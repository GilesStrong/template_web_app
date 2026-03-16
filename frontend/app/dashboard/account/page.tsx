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

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { backendFetch, clearBackendTokens } from "@/lib/backend-auth";

const formatExportFileName = () => {
    const now = new Date();
    const datePart = now.toISOString().replace(/[:.]/g, "-");
    return `deep-mtg-account-export-${datePart}.json`;
};

const toErrorMessage = async (response: Response, fallback: string): Promise<string> => {
    try {
        const payload = (await response.json()) as { detail?: string; message?: string; error?: string };
        return payload.detail ?? payload.message ?? payload.error ?? fallback;
    } catch {
        return fallback;
    }
};

export default function AccountPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const [isExporting, setIsExporting] = useState(false);
    const [isRequestingDelete, setIsRequestingDelete] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmationToken, setDeleteConfirmationToken] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleExport = async () => {
        setError(null);
        setMessage(null);
        setIsExporting(true);

        try {
            const response = await backendFetch(session, "/api/app/user/me/export/");
            if (!response.ok) {
                throw new Error(await toErrorMessage(response, "Failed to export account data."));
            }

            const payload = await response.json();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = formatExportFileName();
            anchor.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 0);

            setMessage("Account data export downloaded.");
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Failed to export account data.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleRequestDelete = async () => {
        setError(null);
        setMessage(null);
        setIsRequestingDelete(true);

        try {
            const response = await backendFetch(session, "/api/app/user/me/delete-request/", { method: "POST" });
            if (!response.ok) {
                throw new Error(await toErrorMessage(response, "Failed to start account deletion."));
            }

            const payload = (await response.json()) as { confirmation_token: string; expires_in_seconds: number };
            setDeleteConfirmationToken(payload.confirmation_token);
            setMessage(
                `Deletion requested. Confirm within ${payload.expires_in_seconds} seconds to permanently delete your account.`
            );
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Failed to start account deletion.");
        } finally {
            setIsRequestingDelete(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirmationToken) {
            setError("Start deletion first to get a confirmation token.");
            return;
        }

        setError(null);
        setMessage(null);
        setIsDeleting(true);

        try {
            const response = await backendFetch(session, "/api/app/user/me/", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ confirmation_token: deleteConfirmationToken }),
            });
            if (!response.ok) {
                throw new Error(await toErrorMessage(response, "Failed to delete account."));
            }

            try {
                await clearBackendTokens();
            } finally {
                await signOut({ callbackUrl: "/login" });
            }
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Failed to delete account.");
            setIsDeleting(false);
        }
    };

    return (
        <div className="flex-1 bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-8">
            <div className="mx-auto max-w-3xl space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">Account</h1>
                    <Button variant="outline" onClick={() => router.push("/dashboard")}>Back to Dashboard</Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Profile</CardTitle>
                        <CardDescription>Signed in as {session?.user?.email ?? "Unknown user"}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button type="button" onClick={handleExport} disabled={isExporting || isDeleting}>
                            {isExporting ? "Exporting..." : "Export My Data"}
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Danger Zone</CardTitle>
                        <CardDescription>
                            Warning: This action permanently deletes your account.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleRequestDelete}
                            disabled={isRequestingDelete || isDeleting || isExporting}
                        >
                            {isRequestingDelete ? "Requesting..." : "Step 1: Request Deletion"}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={isDeleting || isRequestingDelete || isExporting || !deleteConfirmationToken}
                        >
                            {isDeleting ? "Deleting..." : "Delete My Account"}
                        </Button>
                    </CardContent>
                </Card>

                {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
                {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
            </div>
        </div>
    );
}
