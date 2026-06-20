import express from 'express';
import {
  exchangeIdToken,
  getApprovedClients,
  getUserGrants,
  addApprovedClient,
  removeApprovedClient,
  mintNonce,
  listMyAuthorizedApps,
  revokeMyAuthorizedApp,
} from '../controllers/fedcm.controller';
import { rateLimit } from '../middleware/rateLimiter';
import { authMiddleware, serviceAuthMiddleware } from '../middleware/auth';

const router = express.Router();

// Rate-limit nonce minting independently from other FedCM endpoints —
// nonces are cheap server-side but expensive to enumerate, so cap both
// per-IP and overall throughput.
const nonceLimiter = rateLimit({
  prefix: 'rl:fedcm:nonce:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 200 : 60,
});

/**
 * @openapi
 * /fedcm/nonce:
 *   post:
 *     tags:
 *       - Federation
 *     security: []
 *     summary: Mint a single-use FedCM nonce
 *     description: >
 *       The auth UI requests a server-issued nonce just before invoking
 *       `navigator.credentials.get({ identity: { nonce } })`. The IdP
 *       signs the nonce into the issued ID token; `/fedcm/exchange` will
 *       only accept tokens whose nonce was minted here and has not yet been
 *       used. Bound to the requesting origin so a nonce minted for one site
 *       cannot be exchanged from another.
 *     responses:
 *       200:
 *         description: Nonce issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nonce:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing or invalid Origin header.
 */
router.post('/nonce', nonceLimiter, mintNonce);

/**
 * @openapi
 * /fedcm/exchange:
 *   post:
 *     tags:
 *       - Federation
 *     security: []
 *     summary: Exchange a FedCM ID token for an Oxy session
 *     description: >
 *       Implements the FedCM (Federated Credential Management) token
 *       exchange. The relying party passes the ID token it just received
 *       from the browser's FedCM API and gets back an Oxy `AuthSuccess`
 *       payload (user + sessionId + access/refresh tokens). This is the
 *       cookie-less, cross-origin SSO entry point.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: FedCM ID token from the browser.
 *               clientId:
 *                 type: string
 *                 description: Calling app's registered client ID.
 *     responses:
 *       200:
 *         description: Oxy session issued.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccess'
 *       400:
 *         description: Invalid token format.
 *       401:
 *         description: ID token verification failed.
 *       403:
 *         description: Origin not on the approved-clients list.
 */
router.post('/exchange', exchangeIdToken);

/**
 * @openapi
 * /fedcm/clients/approved:
 *   get:
 *     tags:
 *       - Federation
 *     security: []
 *     summary: List origins approved for FedCM token exchange
 *     description: >
 *       Public list of `origin` strings that may call `/fedcm/exchange`.
 *       Browsers query this list when displaying the FedCM account picker.
 *     responses:
 *       200:
 *         description: Approved client origins.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 origins:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/clients/approved', getApprovedClients);

/**
 * @openapi
 * /fedcm/grants/{userId}:
 *   get:
 *     tags:
 *       - Federation
 *     security: []
 *     summary: List RP origins a user has granted via FedCM
 *     description: >
 *       Returns the relying-party origins the user has previously authorized
 *       through FedCM, intersected with the currently-approved client list.
 *       The IdP accounts endpoint (auth.oxy.so) calls this server-to-server to
 *       populate the FedCM `approved_clients` array, which lets Chrome treat
 *       the account as a returning account for those RPs (skips the disclosure
 *       UI and enables silent mediation). Carries no token material or PII.
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The user's id (24-char hex ObjectId).
 *     responses:
 *       200:
 *         description: Granted origins (possibly empty).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 origins:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Missing or malformed userId.
 */
router.get('/grants/:userId', getUserGrants);

/**
 * @openapi
 * /fedcm/clients/approved:
 *   post:
 *     tags:
 *       - Federation
 *     security:
 *       - serviceTokenAuth: []
 *     summary: Approve an origin for FedCM (internal services only)
 *     description: >
 *       Add a new origin to the FedCM approved-clients list. Requires a
 *       service token — third-party developers cannot self-approve.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - origin
 *             properties:
 *               origin:
 *                 type: string
 *                 example: https://example.com
 *     responses:
 *       200:
 *         description: Origin added.
 *       401:
 *         description: Service token missing or invalid.
 *       403:
 *         description: Token is not a service token.
 */
router.post('/clients/approved', serviceAuthMiddleware, addApprovedClient);

/**
 * @openapi
 * /fedcm/clients/approved/{origin}:
 *   delete:
 *     tags:
 *       - Federation
 *     security:
 *       - serviceTokenAuth: []
 *     summary: Remove an approved origin (internal services only)
 *     parameters:
 *       - name: origin
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded origin to remove.
 *     responses:
 *       200:
 *         description: Origin removed.
 *       401:
 *         description: Service token missing or invalid.
 *       403:
 *         description: Token is not a service token.
 *       404:
 *         description: Origin not on the list.
 */
router.delete('/clients/approved/:origin', serviceAuthMiddleware, removeApprovedClient);

/**
 * @openapi
 * /fedcm/me/authorized-apps:
 *   get:
 *     tags:
 *       - Federation
 *     security:
 *       - bearerAuth: []
 *     summary: List the authenticated user's authorized RP apps
 *     description: >
 *       Returns the intersection of the user's FedCM grants with the currently
 *       approved RP client catalog. Powers the "Connected apps" management UI.
 *     responses:
 *       200:
 *         description: Authorized apps (possibly empty).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 apps:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       origin: { type: string }
 *                       name: { type: string }
 *                       description: { type: string }
 *                       firstGrantedAt: { type: string, format: date-time }
 *                       lastUsedAt: { type: string, format: date-time }
 *       401:
 *         description: Authentication required.
 */
router.get('/me/authorized-apps', authMiddleware, listMyAuthorizedApps);

/**
 * @openapi
 * /fedcm/me/authorized-apps/{origin}:
 *   delete:
 *     tags:
 *       - Federation
 *     security:
 *       - bearerAuth: []
 *     summary: Revoke the authenticated user's authorization for an RP origin
 *     parameters:
 *       - name: origin
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded RP origin to revoke.
 *     responses:
 *       200:
 *         description: Authorization revoked.
 *       400:
 *         description: Origin missing or malformed.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: No grant exists for this user+origin.
 */
router.delete('/me/authorized-apps/:origin', authMiddleware, revokeMyAuthorizedApp);

export default router;
