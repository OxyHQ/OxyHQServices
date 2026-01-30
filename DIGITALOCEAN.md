# DigitalOcean App Platform Deployment

Deployment configuration for the OxyHQ SDK monorepo on DigitalOcean App Platform.

All components use **Source Directory:** `/` since they depend on the monorepo workspace structure.

---

## accounts (Expo web app — Static Site)

| Field | Value |
|-------|-------|
| **Type** | Static Site |
| **Source Directory** | `/` |
| **Build Command** | `npm ci && npm run build -w @oxyhq/core && npm run build:js -w @oxyhq/services && npm run build -w accounts` |
| **Output Directory** | `packages/accounts/dist` |

---

## api (Express server — Web Service)

| Field | Value |
|-------|-------|
| **Type** | Web Service |
| **Source Directory** | `/` |
| **Build Command** | `npm ci && npm run build -w @oxyhq/core && npm run build -w @oxyhq/api` |
| **Run Command** | `node packages/api/dist/server.js` |

---

## auth (Next.js app — Web Service)

| Field | Value |
|-------|-------|
| **Type** | Web Service |
| **Source Directory** | `/` |
| **Build Command** | `npm ci && npm run build -w @oxyhq/core && npm run build -w @oxyhq/auth && npm run build -w auth` |
| **Run Command** | `npm start -w auth` |

---

## Important: Heroku Buildpack Behavior

DigitalOcean uses the Heroku Node.js buildpack. It automatically runs `heroku-postbuild` or `build` scripts from the root `package.json` **before** your custom build command. To prevent this from building all packages (including `@oxyhq/services` which requires React Native), the root `package.json` intentionally has **no** `"build"` or `"heroku-postbuild"` script. Each component's custom build command handles everything.

## Notes

- **Build order matters.** `@oxyhq/core` must be built first since all other packages depend on it.
- **auth** also requires `@oxyhq/auth` (`packages/auth-sdk`) to be built before the Next.js app.
- **accounts** is a static site (Expo web export). **api** and **auth** are web services with run commands.
- All components point to the same GitHub repo and branch (`main`).
- **Do not** add `"build"` or `"heroku-postbuild"` to the root `package.json` — this would trigger a full monorepo build including `@oxyhq/services`, which fails without React Native dependencies.
- **accounts** depends on `@oxyhq/services`. Use `build:js` (not `build`) for services on DO — it compiles only the JS targets (commonjs + module) without TypeScript definitions, which would fail without full React Native type dependencies.
