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

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearBackendTokens } from "@/lib/backend-auth";
import { getAvatarUrlFromSession } from "@/lib/avatar";

/**
 * Builds initials from the user's display name for avatar fallback rendering.
 *
 * Args:
 *     name: Optional full name from the authenticated session.
 *
 * Returns:
 *     Uppercase initials or "U" when a name is unavailable.
 */
const getUserInitials = (name: string | null | undefined): string => {
    if (!name) {
        return "U";
    }

    const initials = name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .trim()
        .toUpperCase();
    return initials || "U";
};

/**
 * Authenticated dashboard template page.
 *
 * Returns:
 *     Dashboard shell with account and sign-out actions.
 */
export default function DashboardPage(): JSX.Element {
    const { data: session, status } = useSession();
    const router = useRouter();

    const userInitials = useMemo(() => getUserInitials(session?.user?.name), [session?.user?.name]);
    const avatarUrl = getAvatarUrlFromSession(session);

    /**
     * Clears backend cookies and signs the current user out.
     *
     * Returns:
     *     Promise that resolves after logout is complete.
     */
    const handleSignOut = async (): Promise<void> => {
        try {
            await clearBackendTokens();
        } finally {
            await signOut({ callbackUrl: "/login" });
        }
    };

    if (status === "loading") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex-1 bg-gradient-to-br from-slate-50 to-slate-100">
            <header className="border-b bg-white/80 backdrop-blur-sm">
                <div className="container mx-auto flex items-center justify-between px-4 py-4">
                    <h1 className="text-2xl font-bold">myapp</h1>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground">{session?.user?.email ?? "Unknown user"}</span>
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
                                <DropdownMenuLabel>{session?.user?.name ?? "Account"}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>Account</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void handleSignOut()}>Sign out</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                <div className="mx-auto max-w-4xl space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Template Dashboard</CardTitle>
                            <CardDescription>
                                This page is intentionally minimal. Keep auth, then replace this with your own product features.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <p className="text-sm text-muted-foreground">Suggested next steps for new projects:</p>
                            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                                <li>Create your first backend endpoint.</li>
                                <li>Add a frontend feature page.</li>
                                <li>Write a focused unit test for that feature.</li>
                            </ul>
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" onClick={() => router.push("/dashboard/account")}>
                                    Open Account
                                </Button>
                                <Button onClick={() => void handleSignOut()}>Sign out</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}
