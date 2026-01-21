# Oxy Auth Web

This is the Oxy authentication gateway (OAuth-like), similar to "Sign in with Google."
It is not a user dashboard. The app only handles sign in, sign up, recovery, and
authorization for third-party apps.

## Routes

- `/login` - Password sign-in (email/username + password)
- `/signup` - Password sign-up (email + username + password)
- `/recover` - Password recovery (request → verify → reset)
- `/authorize?token=...&redirect_uri=...&state=...` - Approve a third-party auth session

There is no landing page at `/`.

## API Base URL

The web app calls the API directly. In development it defaults to
`http://localhost:3001`. Override with:

- `NEXT_PUBLIC_OXY_AUTH_URL` (preferred) - Example: `http://localhost:3001`
- `NEXT_PUBLIC_OXY_API_URL` (fallback)
- `OXY_API_URL` (server-side only)

The client will append `/auth` to the base URL if you provide the API host only.

## Development

```bash
# Terminal 1 (API)
cd ../api
npm run dev

# Terminal 2 (Auth web)
cd ../auth
npm run dev
```

Default ports:
- Auth web: http://localhost:3000
- API: http://localhost:3001

## Flow Overview

1. A third-party app creates an auth session via the API.
2. The user is sent to `/authorize?token=...` (web) or the Accounts app (mobile).
3. The auth gateway signs in the user and authorizes the session.
4. The app receives the session token/access token and completes login.
