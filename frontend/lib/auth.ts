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

import { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

type GoogleIdTokenClaims = {
  picture?: string;
  name?: string;
  email?: string;
};

const GOOGLE_ALLOWED_EMAILS_ENV = "GOOGLE_ALLOWED_EMAILS";
const GOOGLE_ENFORCE_ALLOWED_EMAILS_ENV = "GOOGLE_ENFORCE_ALLOWED_EMAILS";

const decodeJwtPayload = (jwtToken: string): GoogleIdTokenClaims | null => {
  const parts = jwtToken.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = Buffer.from(paddedPayload, "base64").toString("utf-8");
    return JSON.parse(decoded) as GoogleIdTokenClaims;
  } catch {
    return null;
  }
};

const getGoogleAllowedEmails = (): Set<string> => {
  const rawValue = process.env[GOOGLE_ALLOWED_EMAILS_ENV];
  if (!rawValue) {
    return new Set();
  }

  const normalizedEmails = rawValue
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  return new Set(normalizedEmails);
};

const isGoogleAllowedEmailsEnforced = (): boolean => {
  const rawValue = process.env[GOOGLE_ENFORCE_ALLOWED_EMAILS_ENV];
  if (!rawValue) {
    return true;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(normalizedValue);
};

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider !== "google") {
        return false;
      }

      if (!isGoogleAllowedEmailsEnforced()) {
        return true;
      }

      const userEmail =
        (typeof user.email === "string" && user.email) ||
        (profile && "email" in profile && typeof profile.email === "string"
          ? profile.email
          : undefined);

      if (!userEmail) {
        return false;
      }

      const allowedEmails = getGoogleAllowedEmails();
      return allowedEmails.has(userEmail.trim().toLowerCase());
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
    async jwt({ token, account, profile }) {
      if (account?.id_token) {
        token.googleAuthToken = account.id_token;

        const claims = decodeJwtPayload(account.id_token);
        if (!token.picture && typeof claims?.picture === "string") {
          token.picture = claims.picture;
        }
        if (!token.name && typeof claims?.name === "string") {
          token.name = claims.name;
        }
        if (!token.email && typeof claims?.email === "string") {
          token.email = claims.email;
        }
      }

      if (profile && "picture" in profile && typeof profile.picture === "string") {
        token.picture = profile.picture;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.picture === "string") {
          session.user.image = token.picture;
        }

        if (typeof token.name === "string") {
          session.user.name = token.name;
        }

        if (typeof token.email === "string") {
          session.user.email = token.email;
        }
      }

      return session;
    },
  },
};
