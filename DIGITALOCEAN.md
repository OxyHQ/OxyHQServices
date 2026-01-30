# DigitalOcean App Platform Deployment

Deployment configuration for the OxyHQ SDK monorepo on DigitalOcean App Platform.

All components use **Source Directory:** `/` since they depend on the monorepo workspace structure.

---

## accounts (Expo web app — Static Site)

| Field | Value |
|-------|-------|
| **Type** | Static Site |
| **Source Directory** | `/` |
| **Build Command** | `npm ci && npm run build --workspace=packages/core && npm run build --workspace=packages/accounts` |
| **Output Directory** | `packages/accounts/dist` |

---

## api (Express server — Web Service)

| Field | Value |
|-------|-------|
| **Type** | Web Service |
| **Source Directory** | `/` |
| **Build Command** | `npm ci && npm run build --workspace=packages/core && npm run build --workspace=packages/api` |
| **Run Command** | `node packages/api/dist/server.js` |

---

## auth (Next.js app — Web Service)

| Field | Value |
|-------|-------|
| **Type** | Web Service |
| **Source Directory** | `/` |
| **Build Command** | `npm ci && npm run build --workspace=packages/core && npm run build --workspace=packages/auth-sdk && npm run build --workspace=packages/auth` |
| **Run Command** | `npm start --workspace=packages/auth` |

---

## Notes

- **Build order matters.** `@oxyhq/core` must be built first since all other packages depend on it.
- **auth** also requires `@oxyhq/auth` (`packages/auth-sdk`) to be built before the Next.js app.
- **accounts** is a static site (Expo web export). **api** and **auth** are web services with run commands.
- All components point to the same GitHub repo and branch (`main`).
