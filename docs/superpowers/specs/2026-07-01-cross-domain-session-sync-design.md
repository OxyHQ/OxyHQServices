# Sesión centralizada y sincronizada cross-domain (web + nativo)

**Fecha:** 2026-07-01
**Estado:** Diseño aprobado (pendiente de revisión del spec por el usuario → plan de implementación)
**Autor:** Nate + Claude

---

## 1. Contexto y motivación

Las apps del ecosistema Oxy corren en **dominios distintos** (`accounts.oxy.so`, `console.oxy.so`, `mention.earth`, `homiio.com`, `allo`, `alia.onl`, …) y en **dos plataformas** (Expo web + nativo). Hoy la sesión se apoya en un esquema **por-dominio de cookies `oxy_rt_<authuser>`** (host-only en cada `api.<apex>`) más una **cadena de cold-boot de 8 pasos** que "adivina" qué cuenta está activa. Ese modelo:

- **No sincroniza** entre apps/dominios: cerrar sesión o cambiar de cuenta en una app no se refleja en las demás.
- Es **frágil**: la plantación de la cookie `oxy_rt` cross-origin la **bloquea** el navegador cuando el usuario tiene "bloquear cookies de terceros" (comprobado con evidencia real en Chrome, 2026-07-01 — ver §14). Sin ese cimiento, **cambiar a una subcuenta no persiste al recargar** (el bug que originó este trabajo: al recargar vuelve a la cuenta primaria).
- Está **mal estructurado**: lógica de sesión duplicada por app, `selectActiveRefreshAccount(... ?? accounts[0])` que enmascara fallos, `activeAuthuser` en `localStorage` tratado como autoridad, dos `authStore` paralelos, iframes de polling, etc.

**Objetivo:** una **única sesión central del dispositivo**, compartida por todas las apps y dominios, que se **sincroniza al instante** (cerrar sesión, añadir cuenta, cambiar cuenta activa) en **web y nativo, como si fuera la misma app** — con código limpio, sin tricky things, sin back-compat ni migración, y con la lógica transversal viviendo en el SDK compartido.

---

## 2. Requisitos (de las clarificaciones)

| # | Requisito | Decisión |
|---|-----------|----------|
| R1 | Modelo de sesión | **Conjunto de cuentas compartido** (añadir/quitar/cerrar se propaga a todas) **+ cuenta activa global** (cambiar la activa cambia en todas). |
| R2 | Alcance de dominios | **Todos** los dominios Oxy (familia `oxy.so`, `mention.earth`, `homiio.com`, `allo`, `alia`, resto). |
| R3 | Alcance de sincronización | **Mismo dispositivo** (varias apps/pestañas del mismo navegador; varias apps nativas del mismo móvil). No se requiere push cross-device en tiempo real. |
| R4 | Latencia | **Instantáneo** en web y nativo por igual, "como si fuera la misma app". |
| R5 | Perfil | El perfil (nombre, avatar, color) **no se snapshotea** en la sesión; se resuelve por el sistema central de usuarios (`POST /users/by-ids` + React Query) y se re-sincroniza cuando el usuario edita sus datos. |
| R6 | Offline | **Offline-first (estilo Instagram)**: la app es usable sin red — sesión persistida localmente, datos cacheados visibles, escrituras encoladas; reconcilia al reconectar. Ver §6.1. |

---

## 3. Principios de diseño (rectores del spec)

1. **Autoridad central única.** El estado de sesión del dispositivo lo posee el servidor (IdP `auth.oxy.so` + `api.oxy.so`). Los clientes son proyecciones de ese estado. Nada de "adivinar" la sesión desde cookies/slots locales.
2. **Corte limpio.** Todo lo que la autoridad central reemplaza se **borra** — sin shims, sin `@deprecated`, sin back-compat, sin migración de datos. Ver §11 "Código a eliminar".
3. **Máxima reutilización / SDK-first.** La lógica transversal (estado, socket, transporte de token) vive en `@oxyhq/core`/`@oxyhq/services`; las apps son finas. Se **reutilizan verbatim** las primitivas probadas (FedCM, `/auth/silent`, `/sso/establish`, keychain, `authSocket`, `requireSameSiteOrigin`, `users/by-ids`) — ver §8 y §11 "Reutilizar".
4. **Tokens por-dominio, sin fugas.** El canal transporta **estado**, nunca tokens crudos. Cada app acuña su propio token de la cuenta activa con las primitivas first-party. Se preserva el hardening #251 (ningún refresh token cruza dominios; cookies host-only).
5. **Contract-first.** Los contratos (`SessionState`, eventos del socket) viven en `@oxyhq/contracts` (Zod), validados con `safeParseContract` en cada respuesta/evento.
6. **Testeable por piezas.** Responsabilidades separadas: estado / socket / transporte de token / UI, cada una aislable y testeable.

---

## 4. Arquitectura

Cuatro piezas; cada app es un cliente fino del SDK.

```
   [Mention web]  [Homiio web]  [Accounts web]   [Mention nativo]  [Homiio nativo]
        │              │              │                 │                 │
        └──── WSS (token en handshake, room = device:<deviceId>) ─────────┘
                                   │
                        ┌──────────┴───────────┐
                        │  Autoridad central    │  fuente de verdad: {deviceId, accounts[], activeAccountId, revision}
                        │  auth.oxy.so + api    │  acuña tokens por-dominio (primitivas first-party)
                        └───────────────────────┘
```

1. **Autoridad central** (`api.oxy.so` + IdP `auth.oxy.so`): posee y persiste el `SessionState` del dispositivo. Mutaciones vía REST (`/session/device/{state,switch,add,signout}`).
2. **Canal en tiempo real por-dispositivo**: **una** conexión Socket.IO central por app (web y nativo), autenticada con **token en el handshake** (no cookies → inmune al bloqueo de 3PC), room `device:<deviceId>`. Cualquier mutación → el servidor emite `session_state` a todas las conexiones del mismo dispositivo → instantáneo.
3. **Tokens por-dominio**: cada app acuña su token de la cuenta activa con las primitivas first-party existentes (web: FedCM / `/auth/silent` / `/sso/establish`; nativo: keychain compartido).
4. **SDK unificado** (`@oxyhq/core` `SessionClient` + bindings web/nativo): estado + socket + flujos + restore. Web y nativo comparten el núcleo; solo difiere el `TokenTransport`.

**Consecuencia:** el bug original desaparece — el conjunto de cuentas es **estado autoritativo del servidor**, no depende de la cookie `oxy_rt` frágil, que **se elimina por completo** (corte limpio, ver §11.4).

---

## 5. Modelo de datos

### 5.1 Cliente (`@oxyhq/core`) — sin tokens, sin perfil

```ts
interface SessionAccount {
  accountId: string;        // user _id — identidad estable
  sessionId: string;        // sesión de ESTE dispositivo para esa cuenta
  authuser: number;         // índice de orden estable del dispositivo (estilo Google `authuser=N`),
                            // asignado por el servidor — NO ligado a cookies
}
interface SessionState {
  deviceId: string;
  accounts: SessionAccount[];      // solo referencias de identidad
  activeAccountId: string | null;  // "cuenta activa global" del dispositivo
  revision: number;                // contador monótono (orden/idempotencia)
  updatedAt: number;
}
```

El **perfil** de cada `accountId` se resuelve con el sistema central de usuarios (`getUsersByIds` → `POST /users/by-ids` + React Query). La capa de sesión **no cachea perfil**.

### 5.2 Servidor (autoridad canónica)

Se **reescribe** el modelo de sesión: hoy hay un `Session` por `(user, device)` que **almacena sus propios tokens**; pasa a haber **un `DeviceSession` por dispositivo físico** que agrega cuentas:

```
DeviceSession { deviceId, accounts: [{ accountId, sessionId, addedAt, operatedByUserId? }], activeAccountId, revision, updatedAt }
```

- Los `Session` dejan de almacenar `accessToken`/`refreshToken`/`previousRefreshToken` (borrados). La **revocación** vive en el `RefreshToken` opaco (hash-only, rotación single-use, reuse-detection) — **se conserva**. El access token es **efímero y se acuña, nunca se persiste**.
- `operatedByUserId` (auditoría act_as de subcuentas) se conserva como campo de la entrada de cuenta.

### 5.3 Contrato del canal + REST (`@oxyhq/contracts`)

- `deviceSessionStateSchema` / `sessionAccountSchema` (extienden el `deviceSessionAccountSchema` ya existente; añaden `deviceId`, `activeAccountId`, `authuser`, `revision`).
- Evento socket `session_state`: el `SessionState` **sin tokens**, **idempotente** — la app reemplaza su estado local si `revision` recibido > aplicado (last-writer-wins por revisión).
- Evento `user_changed:<accountId>`: señal barata (solo el id) → la app invalida la query de ese usuario → refetch del servicio central (perfil siempre sincronizado, sin datos en el canal).

### 5.4 Regla de escritura/lectura

- **Mutaciones** → **REST autenticado** (`POST /session/device/{switch,add,signout}`): el servidor persiste, sube `revision`, y **difunde** por el socket.
- **Socket = solo-recepción** (push). Nunca se escribe/confía estado por socket → sin IDOR/spoof.
- **(Re)conexión / arranque** → `GET /session/device/state` (resync por `revision`) y luego suscribe. Si el socket cae, revalida al enfocar (capa de resiliencia).

---

## 6. Flujos

Todas las mutaciones: **REST → persistir + `revision++` + difundir a `device:<deviceId>`**. Las apps son reactivas.

**A) Cerrar sesión de una cuenta** — `POST /session/device/signout { accountId }`
1. Servidor revoca el `Session`/`RefreshToken` de esa cuenta en el dispositivo (revocación real), la quita de `accounts`, y si era la activa recalcula `activeAccountId` (siguiente cuenta o `null`).
2. `revision++`, difunde `session_state`.
3. Todas las apps del dispositivo reciben el estado → quitan la cuenta; si era la activa, montan la nueva activa (o "sin sesión"). Instantáneo.

**B) Cambiar cuenta activa** — `POST /session/device/switch { accountId }`
1. Servidor: `activeAccountId = accountId` (re-check act_as si es subcuenta), `revision++`, difunde.
2. Cada app recibe el estado → **acuña su token de la nueva activa** (web: FedCM/`/auth/silent`/`/sso`; nativo: keychain) y re-renderiza. Cuenta activa global, instantánea.

**C) Añadir cuenta** — login normal → `POST /session/device/add` (implícito al iniciar sesión)
1. Se asocia el `Session` de la cuenta al `DeviceSession`, `activeAccountId = nueva`, `revision++`, difunde.
2. Aparece en la lista de todas las apps al instante.

**Reconexión/arranque:** `GET /session/device/state` → suscribe. Socket caído → revalidar al enfocar. Nunca desincronizado.

### 6.1 Offline-first (estilo Instagram)

La app debe ser **usable sin red**. El diseño lo cumple reutilizando el offline-first ya existente + persistencia durable del estado de sesión:

- **Sigues logueado offline.** El cliente cachea **durablemente** el último `SessionState` **y** el token por-dominio: web en storage persistido (localStorage/IndexedDB), **nativo en el keychain de app-group** (durable por naturaleza). En arranque offline, `SessionClient` **bootea desde la caché** — logueado y usable, **sin llamadas de red**. Estar "logueado" no requiere hablar con el servidor.
- **Datos de la app.** Se reutiliza el offline-first existente (`@tanstack/react-query-persist-client`, `networkMode:'offlineFirst'`, whitelist persistida, cola de mutaciones con `mutationKey` estable — ver §11 KEEP `queryClient`). Contenido cacheado visible + interacción; escrituras **encoladas** y **vaciadas al reconectar**.
- **Reconexión.** El socket vuelve → `GET /session/device/state` resync por `revision` + reconciliación last-writer-wins → recupera lo ocurrido mientras estuvo offline. La conexión del socket usa el patrón de reintento existente.
- **Mutaciones de sesión offline** (switch/signout/add): **update optimista local** + encolar; al reconectar se confirman contra el servidor y el `session_state` autoritativo reconcilia. Un signout offline limpia local y **encola la revocación real** (que se ejecuta al volver).
- **Token expirado offline.** Si el token cacheado caducó y no hay red para re-acuñar, la app permanece en modo lectura/offline (React Query sirve caché) y re-acuña en cuanto vuelve la red; nunca se fuerza un logout por falta de red.
- **Indicadores.** `useOnlineStatus()` (ya existe, KEEP) alimenta banners "sin conexión" / "sincronizando".

**Consecuencia de diseño:** el `SessionState` debe ser **serializable y persistible** (lo es — solo ids + `revision`), y `SessionClient` arranca **caché-primero, red-después** (nunca bloquea el primer render esperando al servidor).

---

## 7. Identidad de dispositivo cross-domain

Con 3PC bloqueado, cada RP llega al IdP por hosts CNAME first-party (`auth.<apex>`), orígenes distintos con cookies separadas. Para enrutar el push al **mismo dispositivo**:

- **El `deviceId` lo posee y emite el IdP central** (`auth.oxy.so`) en una cookie de dispositivo **first-party a `auth.oxy.so`** (host-only, httpOnly, larga duración). Hoy `deriveServiceDeviceId`/`deriveStableDeviceId` re-derivan el id por (user, RP)/UA/IP → se **reescribe** para emitir **un `deviceId` estable persistido por dispositivo físico**.
- Se **propaga** a cada sesión RP: FedCM (claims de la aserción, first-party al IdP) y `/sso/establish` (dentro del token `et` firmado). Todas las apps web del mismo navegador acaban con el mismo `deviceId` central.
- **Nativo**: en el primer login la app pide el `deviceId` al central (llamada directa, sin 3PC) y lo guarda en el keychain de app-group → todas las apps nativas del dispositivo lo comparten.
- **Enrutado del socket**: el room se deriva del `deviceId` **dentro del token firmado** del handshake (`authSocket`), nunca de input del cliente. Ownership-check antes del join.

**Limitación aceptada (§13):** una app **nativa** y un **navegador web** en el mismo teléfono físico son identidades de dispositivo separadas (sandbox del SO); se sincronizan por el estado del servidor al siguiente fetch/enfoque, no por el push instantáneo. Sin enlace explícito (YAGNI).

---

## 8. Transporte por plataforma (web vs nativo)

El **núcleo es uno** (`SessionClient`: estado + socket + flujos). Solo se inyecta el binding `TokenTransport` (cómo obtener el token de una cuenta).

**Web (por dominio)** — primitivas first-party **reutilizadas verbatim** (KEEP):
- FedCM silent/interactivo (`OxyServices.fedcm.ts`) → `POST /fedcm/nonce` + `POST /fedcm/exchange`.
- Iframe `/auth/silent` per-apex (`OxyServices.silent.ts` + `packages/auth` `GET /auth/silent` + `mintSessionForClient`, `iss` SIEMPRE `auth.oxy.so`).
- Bounce top-level `/sso` → `/sso/establish` (`packages/auth`) → code → `exchangeSsoCode` (`OxyServices.sso.ts` → `POST /sso/exchange`).
- **El esquema de cookies `oxy_rt` se elimina** (ver §11.4): web acuña **siempre** por primitivas first-party; el token efímero se guarda en memoria (`tokenStore`), no en cookie de refresh.

**Nativo (Expo)** — primitivas **reutilizadas** (KEEP):
- Keychain de app-group `group.so.oxy.shared` (`KeyManager`) + `requestChallenge`/`verifyChallenge`/`signInWithSharedIdentity` (`SignatureService`).

**Socket central**: `api.oxy.so`, room `device:<deviceId>`, construido sobre `authSocket` (`@oxyhq/core`). Reemplaza el `useSessionSocket` per-dominio.

```
@oxyhq/core: SessionClient (estado + socket + flujos)   ← idéntico web/nativo
     ├── TokenTransport.web    → FedCM / /auth/silent / /sso/establish
     └── TokenTransport.native → keychain app-group (KeyManager + verifyChallenge)
```

---

## 9. Seguridad

- **Qué viaja por el canal:** solo estado (ids de cuenta, activa, `revision`). Nunca tokens crudos ni refresh tokens. → preserva #251.
- **Auth del socket:** `authSocket` (token firmado en handshake, `validateSession` obligatorio, `claimedUserId === session.userId`). Room `device:<deviceId>` del token; ownership-check antes del join → anti-IDOR.
- **Escrituras solo REST bearer**; socket solo-recepción → sin spoof por socket. Bearer → sin CSRF token; `requireSameSiteOrigin` + `createOxyCors` en `/session/device/*`.
- **Aislamiento por dominio:** cada app acuña su token first-party; un dominio comprometido no obtiene tokens de otro.
- **Cerrar sesión = revocación REAL** server-side (RefreshToken/deactivateSession), no solo limpiar cliente.
- **Comparación de secretos** con `verifySecret` (constant-time), nunca `===`.
- **Cookie `deviceId` central:** host-only `auth.oxy.so`, httpOnly → no exfiltrable por XSS de un RP.
- Identidad del actor server-side vía `getRequiredOxyUserId` — nunca ids del cliente (anti mass-assignment/IDOR).

---

## 10. Refactor del cliente (apps)

- **`packages/accounts`**: `managed-accounts.tsx` (switch), `sessions.tsx`, `security.tsx`, gates de `(auth)`/`(tabs)` → consumen `SessionState`/`SessionClient`; se borra el polling manual (`refreshSessions` en pull-to-refresh, doble-tap del logo, reload). El montaje de `<OxyProvider>` no cambia (la lógica vive en el SDK).
- **`packages/services`**: `OxyContext` (cold-boot, `switchToAccount`, `useSessionSocket`, `restoreViaRefreshCookie`, `restoreStoredSession`), `useSessionManagement`, `silentSessionRestore`, `activeAuthuser`, `useDeviceAccounts` → reconsolidados sobre `SessionClient`. Los contenedores de UI (`AccountSwitcher`, `SignInModal`, `OxyAuthScreen`, `OxySignInButton`) **se conservan** (siguen las nuevas rutas por debajo).
- **`packages/auth-sdk`**: `WebOxyProvider` reescrito sobre `SessionClient`; `AuthManager`, `useSessionSocket`, `authStore`, `accountStore`, `sessionHelpers`, `storageHelpers` → borrados/reescritos (ver §11).

---

## 11. Código a eliminar / reescribir / reutilizar (exacto, del barrido)

> Leyenda: 🔴 borrar · 🟡 reescribir/consolidar en el modelo central · 🟢 reutilizar verbatim.

### 11.1 `@oxyhq/core`

**🔴 BORRAR**
- `mixins/OxyServices.auth.ts`: `refreshAllSessions`(+`RefreshAllOptions`), `refreshTokenViaCookie`/`_refreshCookieRaw`, `getUserBySession`/`getUsersBySessions`, `_decodeSessionIdFromAccessToken`.
- `OxyServices.base.ts`: `establishDeviceRefreshSlot`.
- `AuthManager.ts`: `restoreFromCookies`(+`_lastRestoreAt`), `refreshToken`/`_doRefreshToken`, `activeAuthuser` + `get/read/write/clearActiveAuthuser` + `STORAGE_KEYS.ACTIVE_AUTHUSER`, BroadcastChannel cross-tab (`_initBroadcastChannel`/`_handleCrossTabMessage`/`_broadcast`/…), `_hydrateUnknownUser`/`toMinimalUser`, `decodeSessionIdFromAccessToken`/`decodeAuthuserFromAccessToken`.
- `utils/coldBoot.ts`: `runColdBoot` (+ tipos).
- `CrossDomainAuth.ts`: clase completa.
- `utils/sessionUtils.ts`: `normalize/sort/deduplicate/merge…Sessions`.
- `models/session.ts`: `StorageKeys(sessions, activeSessionId)`. `models/interfaces.ts`: `RefreshAllAccount(+User+Response)`, `RefreshCookieResponse`. `AuthManagerTypes.ts`: `RestoreFromCookiesResult/Options`.

**🟡 REESCRIBIR → `SessionClient`**
- `AuthManager.ts` (clase → proyección de `SessionState` sobre socket): `switchAuthuser`, `signOutAuthuser`/`signOutAllViaCookies`, `setupCookieRefresh`, `handleAuthSuccess`, superficie pública (`initialize`/`signOut`/`getAccounts`/…). `AuthManagerTypes.ts`: `AuthManagerAccount`, `SwitchAuthuserResult`.
- `mixins/OxyServices.auth.ts`: `logoutSessionByAuthuser`, `logoutAllSessionsViaCookie`, `getSessionsBySessionId`/`logoutSession`/`logoutAllSessions`, `validateSession`. `mixins/OxyServices.accounts.ts`: `switchToAccount`.
- `utils/ssoBounce.ts`: `allowSsoBounce`/`ssoPriorSessionKey` (gate por presencia en `SessionState`).
- `models/session.ts`: `ClientSession`, `MinimalUserData`, `SessionLoginResponse`. `models/interfaces.ts`: `DeviceSession*`, `LoginResponse`.
- `HttpService.ts`: `refreshAccessToken`/`setAuthRefreshHandler` (rewire del handler a `SessionClient`).

**🟢 REUTILIZAR** (primitivas de mint/token/transporte, verbatim)
- Mint web: `OxyServices.fedcm.ts`, `OxyServices.silent.ts` (`silentSignIn`), `OxyServices.sso.ts` (`exchangeSsoCode`/`generateSsoState`), `OxyServices.redirect.ts`, `utils/ssoReturn.ts` (`consumeSsoReturn`), `utils/ssoBounce.ts` (guards de loop, `ssoSignedOutKey`).
- Mint nativo: `OxyServices.auth.ts` (`requestChallenge`/`verifyChallenge`/`signInWithSharedIdentity`, `claimSessionByToken`, Commons/QR), `crypto/keyManager.ts`, `crypto/signatureService.ts`.
- Token store: `OxyServices.base.ts` (`setTokens`/`getAccessToken`/`onTokensChanged`/`getSessionBaseUrl`/`createLinkedClient`/`waitForAuth`), `HttpService.ts` (`tokenStore`).
- Transporte/infra: `OxyServices.utility.ts` (`authSocket`, `auth()`/`serviceAuth()`), `utils/fapiAutoDetect.ts` (`registrableApex`/`autoDetectAuthWebUrl`), `utils/authWebUrl.ts`, `utils/authHelpers.ts`.
- Servicio de usuarios: `OxyServices.user.ts` (`getUsersByIds`).

### 11.2 `@oxyhq/services`

**🔴 BORRAR**: `OxyContext.tsx` → `restoreViaRefreshCookie`, `persistSessionDurably`, `clearPriorSessionHint`, IdP session-check iframe (`checkIdPSession`…), `useWebSSO` auto-check. `silentSessionRestore.ts` → `selectActiveRefreshAccount`. `activeAuthuser.ts` → `read/write/clearActiveAuthuser`, `markSignedOut`/`clearSignedOut`/`isSilentRestoreSuppressed`, `clearSsoBounceState`. `useSessionManagement.ts` → `findReplacementSession`. `sessionHelpers.ts` → `validateSessionBatch`. `useDeviceAccounts.ts` → `markCurrentAccount`. `hooks/useAuthOperations.ts` → `clearPriorSessionHintSafe`.

**🟡 REESCRIBIR**: `OxyContext.tsx` (`OxyProvider`/`OxyContextState`/`restoreSessionsFromStorage`(8 pasos)/`restoreStoredSession`/`handleWebSSOSession`/`switchToAccount`/`signInWithPassword`/`clearAllAccountData`/`useSessionSocket` wiring/`handleTokenChange`/`markAuthResolved`), `useSessionManagement.ts`(`useSessionManagement`/`switchSession`/`refreshSessions`), `useSessionSocket.ts`, `inSessionTokenRefresh.ts`(`createInSessionRefreshHandler` — quitar el brazo refresh-cookie), `useWebSSO.ts`(auto silent), `hooks/useAuthOperations.ts`(`signIn`/`logout`/`logoutAll`), `crossApex.ts`, `sessionHelpers.ts`(`fetchSessionsWithFallback`), `useDeviceAccounts.ts`, `useDeviceManagement.ts`, `queries/useServicesQueries.ts`(`useSessions`).

**🟢 REUTILIZAR**: `silentSessionRestore.ts`(`mintSessionViaPerApexIframe`), `runSsoReturn`, `inSessionTokenRefresh.ts`(`startTokenRefreshScheduler`), `useWebSSO.ts`(`signInWithFedCM` interactivo, `isWebBrowser`), UI (`SignInModal`, `OxyAuthScreen`, `AccountSwitcher(+Screen)`, `OxySignInButton`, `OxyProvider` wrapper), `authStore.ts`, `useAuth.ts`, `useOxyAuthSession.ts`/`deviceFlowSignIn.ts` (device-flow QR), `queries/useAccountQueries.ts` (perfil vía user-data), `queryKeys.ts`, storage init.

### 11.3 `@oxyhq/auth` (auth-sdk web)

**🔴 BORRAR**: `WebOxyProvider.tsx` → cold-boot `cookie-restore` step, `hasPriorSessionWeb`/`markPriorSessionWeb`/`clearPriorSessionWeb`, `markSignedOutWeb`/`clearSignedOutWeb`. `hooks/useSessionSocket.ts` (per-dominio) → `handleSessionUpdate` whitelist + `triggerLocalSignOut`; el hook entero se sustituye por la suscripción central. `stores/authStore.ts` (duplicado). `utils/sessionHelpers.ts` → `fetchSessionsWithFallback`/`validateSessionBatch`. `utils/storageHelpers.ts` → `getStorageKeys`/`SessionStorageKeys`.

**🟡 REESCRIBIR**: `WebOxyProvider.tsx` (componente + `authManager`/`createAuthManager` + `initAuth` cold-boot + `evaluateSsoBounce` + estado `accounts/activeAuthuser` + `handleAuthSuccess`/`commitClaimedSession` + `switchAccount`/`switchSession`/`signOutAccount`/`signOutAll` + `signOut` + `useAuth`/`WebAuthState`/contexto). `stores/accountStore.ts`. `useSessionSocket.ts`(`getSocketIO`/transporte → mueve al `SessionClient`). `utils/sessionHelpers.ts`(`mapSessionsToClient`). `queries/useServicesQueries.ts`, `mutations/useServicesMutations.ts`, `queries/useAccountQueries.ts`, `queryKeys.ts`(namespaces sessions/accounts).

**🟢 REUTILIZAR**: `WebOxyProvider.tsx` → `runSsoReturn`/intercept + bfcache, `runSsoBounce`/guards de loop, `fedcmSilentSignInAttempted` + fedcm-silent step, `signIn`/`signInWithFedCM`/`signInWithRedirect`. `hooks/useWebSSO.ts`, `hooks/useCommonsSignIn.ts`, `hooks/queryClient.ts`, `utils/storageHelpers.ts`(`createPlatformStorage`…).

### 11.4 `oxy-api` (servidor)

**🔴 BORRAR**: `models/Session.ts` → campos `accessToken`/`refreshToken`/`previousRefreshToken`/`tokenRotatedAt`. `services/refreshToken.service.ts` → `buildUserIdToAuthuserMap`/`pickLruAuthuser`/`classifyRefreshCandidates`/`selectActiveCandidate`, `parseAllRefreshCookies`/`refreshCookieName`/`REFRESH_COOKIE_NAME_RE`/`MAX_DEVICE_ACCOUNTS`/`setRefreshCookie`/`clearRefreshCookie`/`clearAllRefreshCookies`/`clearLegacyParentRefreshCookie`. `services/session.service.ts` → `refreshTokens` (+ grace path). `controllers/session.controller.ts` → `getUserBySession`, `getUsersBySessions`.

**🟡 REESCRIBIR**: `models/Session.ts`(`Session`→entrada de cuenta en `DeviceSession`). `services/refreshToken.service.ts`(`issueAndSetRefreshCookie`→`/session/device/add`). `services/session.service.ts`(`createSession`→upsert en `DeviceSession`). `controllers/session.controller.ts`(`getUserSessions`/`getDeviceSessions`→`GET /session/device/state`; `logoutSession`/`logoutAllSessions`/`logoutAllDeviceSessions`→`POST /session/device/signout`). `routes/auth.ts`(`POST /auth/refresh`, `/auth/refresh-all`→`GET /session/device/state`; `/auth/session`→`/session/device/add`; `/auth/logout`→`/session/device/signout`). `server.ts`(socket: `io.use` inline + room `user:<id>` + `emitSessionUpdate`→`authSocket` + room `device:<deviceId>` + broadcast `SessionState`). `utils/deviceUtils.ts`(`deriveServiceDeviceId`/`deriveStableDeviceId`→un `deviceId` persistido).

**🟢 REUTILIZAR**: `models/RefreshToken.ts`, `models/AuthSession.ts`, `services/refreshToken.service.ts`(`issueRefreshToken`/`rotateRefreshToken`/`revokeFamily*`), `services/session.service.ts`(`validateSession*`/`getSession*`/`getAccessToken`/`deactivateSession*`/`ensureManagedSessionAuthorized`), `services/authSession.service.ts`, `utils/sessionCache.ts`, `controllers/session.controller.ts`(`validateSession*`/`updateDeviceName`), `routes/auth.ts` device-flow QR, `utils/authSessionSocket.ts`, `utils/sessionUtils.ts`(`generateSessionTokens` access-half/`validateAccessToken`), `routes/sso.ts` + `services/ssoCode.service.ts` + `services/fedcm.service.ts`, `routes/fedcm.ts`, `middleware/originGuard.ts` + `middleware/auth.ts`, `packages/auth/server` (FedCM IdP + `/auth/silent` + `/sso`/`/sso/establish` + `mintSessionForClient`).

### 11.5 Compartidos (KEEP)

`@oxyhq/core/server`: `authSocket`, `requireSameSiteOrigin`, `verifySecret`, `safeFetch`, `createOxyCors`, `createOxyAuthMiddleware`/`getRequiredOxyUserId`. `packages/protocol`: `canonicalJson`/`signingInput`. `@oxyhq/contracts`: `deviceSessionAccountSchema` (base a extender), `safeParseContract`/`resolveUserId`. `POST /users/by-ids` + `OxyServices.user.getUsersByIds` + hooks React Query de perfil.

---

## 12. Fases de implementación

Orden de construcción (contracts → core → consumidores). Cada fase es un corte limpio de su alcance.

- **Fase 1 — Contracts + autoridad servidor** (aditivo). `@oxyhq/contracts`: schemas de `SessionState` + eventos. `oxy-api`: `DeviceSession`, rutas `/session/device/{state,switch,add,signout}`, canal `device:<deviceId>` (`authSocket`), emisión de `deviceId` en el IdP. **Publicar contracts primero.**
- **Fase 2 — `@oxyhq/core` `SessionClient`** (estado + socket + flujos + `TokenTransport`). Borrar piezas core reemplazadas. Tests jest.
- **Fase 3 — `@oxyhq/services`**: `OxyContext` sobre `SessionClient`; borrar cold-boot enredado, `useSessionSocket`, `silentSessionRestore`, `activeAuthuser`; recablear pantallas.
- **Fase 4 — `@oxyhq/auth`**: `WebOxyProvider` sobre `SessionClient` (`TokenTransport.web`); borrar `AuthManager`/stores duplicados.
- **Fase 5 — Apps**: `accounts` (switcher, sesiones, seguridad, gates); Mention/Homiio/etc = bump de versión + wiring. Publicación coordinada + bump de consumidores + lockfiles en el mismo commit.
- **Fase 6 — Barrido de código muerto + docs**: eliminar huérfanos; actualizar AGENTS.md.

**Nota:** el servidor (Fase 1) es el mayor bloque — `Session` deja de almacenar tokens y todo el esquema `oxy_rt` desaparece. Es corte limpio, no migración de datos (sesiones vivas se re-acuñan por las primitivas first-party al primer arranque).

---

## 13. Riesgos y limitaciones

- **Nativo-app ↔ web-en-el-mismo-móvil**: identidades de dispositivo separadas (sandbox del SO) → no instantáneo entre ellos; se reconcilian por estado al enfocar. Sin enlace explícito (YAGNI). Documentado y aceptado.
- **Verificación real obligatoria**: el comportamiento cross-domain/3PC/socket **no** lo captan jest/tsc — hay que verlo en navegador real (dos dominios) y en nativo (ver §14).
- **Migración operacional**: al desplegar, las cookies `oxy_rt` existentes quedan huérfanas (inertes); las sesiones se re-acuñan. No hay pérdida de sesión si las primitivas first-party (FedCM/silent/sso) están sanas.
- **`deviceId` estable**: emitir un id persistido por dispositivo sin colisionar ni fragmentar es delicado; es el punto técnico a validar con más cuidado.

---

## 14. Fuera de alcance

- **Sync cross-device en tiempo real** (cerrar en móvil → cerrar en portátil al instante). Queda en el comportamiento actual (eventual, vía gestión de sesiones/revocación).
- **Enlace explícito nativo↔web** en el mismo dispositivo físico.

---

## 15. Evidencia que fundamenta el diseño (2026-07-01, navegador real)

Verificado en vivo en `accounts.oxy.so` con Chrome "bloquear cookies de terceros":
- `accounts.oxy.so → api.oxy.so` es **same-site** (`Sec-Fetch-Site: same-site`, `eTLD+1 = oxy.so`).
- Con sesión primaria activa, `POST /auth/refresh-all` devolvía **0 cuentas** y `POST /auth/refresh?authuser=0` **401** → **el primario no tenía cookie `oxy_rt_0`**; la sesión se restauraba solo por FedCM/silent.
- `POST /auth/session` respondía **200** con `Set-Cookie` válido (curl lo almacena y reautentica), pero el **navegador descartaba la escritura cross-origin** en estado virgen. Tras visitar `api.oxy.so` first-party una vez, todas las escrituras funcionaban.
- Reproducción end-to-end: con el slot plantado + `activeAccountId`, recargar **sí** restauraba la subcuenta — confirmando que la lógica de switch/restore es correcta y el fallo está en el **cimiento** (la cookie que no se planta). → justifica mover la autoridad al servidor + canal, no a cookies cross-origin.
