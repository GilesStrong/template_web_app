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

import { useEffect } from "react";
import { signOut, useSession, SessionProvider } from "next-auth/react";

import { clearBackendTokens, ensureBackendTokens } from "@/lib/backend-auth";

function BackendUserSync() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (status === "unauthenticated") {
      void clearBackendTokens();
      return;
    }

    const sync = async () => {
      try {
        await ensureBackendTokens(session);
      } catch (error) {
        console.error("Error syncing backend auth tokens:", error);
        try {
          await clearBackendTokens();
        } catch (clearError) {
          console.error("Error clearing backend auth tokens:", clearError);
        }

        const message =
          error instanceof Error && error.message
            ? error.message
            : "Unable to complete sign in. Please try again.";
        const callbackUrl = `/login?error=${encodeURIComponent(message)}`;
        await signOut({ callbackUrl });
      }
    };

    void sync();
  }, [session, status]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BackendUserSync />
      {children}
    </SessionProvider>
  );
}
