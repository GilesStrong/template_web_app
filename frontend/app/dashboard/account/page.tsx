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

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clearBackendTokens } from "@/lib/backend-auth";

/**
 * Lightweight account page for template repositories.
 *
 * Returns:
 *     Account page with session details and basic navigation/logout actions.
 */
export default function AccountPage(): JSX.Element {
    const { data: session } = useSession();
    const router = useRouter();

    /**
     * Clears backend cookies and signs the user out.
     *
     * Returns:
     *     Promise that resolves once sign-out redirect starts.
     */
    const handleSignOut = async (): Promise<void> => {
        try {
            await clearBackendTokens();
        } finally {
            await signOut({ callbackUrl: "/login" });
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
                    <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            Keep this page simple in the template. Add project-specific profile settings later.
                        </p>
                        <Button onClick={() => void handleSignOut()}>Sign out</Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
