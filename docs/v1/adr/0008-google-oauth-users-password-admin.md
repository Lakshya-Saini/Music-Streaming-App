# ADR-0008: Google sign-in for listeners, password login reserved for the single admin

## Status

Accepted

## Context

Playback and playlists needed to move behind authentication, and the app needed an admin role gated to the upload/import pipeline (previously wide open to anyone who could reach the API). Two audiences have genuinely different needs:

- **Listeners** are the general public — the app has no reason to own or verify a password for them, and asking a casual browser to invent yet another account/password is friction with no corresponding benefit to the app.
- **The admin** is a single, known operator responsible for content ingestion. There is exactly one of them, they're trusted with a real password, and self-service registration for this role would be a privilege-escalation path, not a convenience.

## Decision

Split authentication by audience instead of building one flow for both:

1. **Listeners authenticate exclusively via Google** (`POST /auth/google`). The client renders Google's own "Continue with Google" button (Google Identity Services' hosted JS, loaded from `accounts.google.com/gsi/client`), which returns a signed ID token credential directly to the browser. That token is sent to the server, verified with `google-auth-library`'s `OAuth2Client.verifyIdToken` (signature, audience = our `GOOGLE_CLIENT_ID`, and `email_verified`), and the app never sees or stores a password for these accounts. The first successful Google sign-in for a new email auto-provisions a `role: 'user'` account; there is no separate self-service registration endpoint.
2. **The admin authenticates with a password** (`POST /auth/login`, unchanged from the original design). There is no `POST /auth/register` — the one admin account is created out-of-band by `server/scripts/seed-admin.js`, run directly against MongoDB with an operator-supplied email and password. The script refuses to create a second admin: if a `role: 'admin'` document already exists under a different email, it errors out rather than silently allowing two.
3. Both flows converge on the same app-issued JWT (`sub`, `email`, `role`), so every downstream guard (`JwtAuthGuard`, `RolesGuard` + `@Roles('admin')`) is identical regardless of how the user signed in.
4. The `User` schema supports both shapes on one collection: `passwordHash` and `googleId` are both optional, `authProvider: 'password' | 'google'` records which one actually applies to a given document, and a sparse unique index on `googleId` prevents two Google accounts from colliding without forcing password accounts to have a `googleId` at all.
5. If a Google sign-in attempt resolves to an email that already belongs to the admin account, it's rejected outright (`role === 'admin'` check in `AuthService.loginWithGoogle`) rather than silently logging in as admin or merging accounts — the admin's identity is never reachable through the Google path.

## Consequences

- No password reset flow, no email-verification flow, and no credential-stuffing surface for listener accounts — Google owns all of that.
- The app depends on Google's identity infrastructure being configured correctly (`GOOGLE_CLIENT_ID` on the server, matching `VITE_GOOGLE_CLIENT_ID` baked into the client build, and the deployment's real origin registered as an authorized JavaScript origin in Google Cloud Console). Misconfiguration fails closed and loudly: an unset `GOOGLE_CLIENT_ID` makes `/auth/google` return `503 Service Unavailable` immediately rather than silently accepting unverified tokens.
- Because `VITE_GOOGLE_CLIENT_ID` is a Vite build-time value, not a runtime one, changing it always requires rebuilding the `client` image — see [`issues/client-issues.md`](../issues/client-issues.md#continue-with-google-button-showed-the-not-configured-placeholder-after-setting-vite_google_client_id) for the Docker-specific gotcha this caused.
- There is deliberately no path — API or UI — that can create or promote an admin account short of running `seed-admin.js` with direct database access. This is intentional: admin is a deployment-time decision made by whoever controls the server, not a runtime app feature.
- The native `<audio>` element can't attach an `Authorization` header, so `JwtAuthGuard` also accepts the same JWT via a `?token=` query parameter on `/tracks/:id/stream` specifically. This is a narrower, deliberate exception rather than a general rule — every other authenticated route only accepts the header.
