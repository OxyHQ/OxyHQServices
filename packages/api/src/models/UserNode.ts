import mongoose, { Document, Schema } from 'mongoose';

/**
 * UserNode (self-sovereign identity layer — F5a user nodes / decentralization)
 *
 * Operational cache of a user's registered personal data node. The AUTHORITY for
 * a node registration is a signed `type:'node'` record on the user's hash chain
 * (`collection: 'app.oxy.node'`, `rkey: 'self'`, last-writer-wins) — this row is
 * a denormalised, fast-to-read projection of that record plus the live liveness
 * state Oxy maintains in the background.
 *
 * ## The read-path invariant
 *
 * Nothing in a request's READ path ever touches a node. A node being down means
 * this row is stale-but-instant, never slow. `status`/`lastSeenAt`/`lastError`
 * are updated ONLY by background liveness probes and the (optional) sync worker
 * via `safeFetch` (SSRF-safe) — never inline in a request handler. The DID
 * document's `#oxy-node` service entry is derived on demand by reading THIS row
 * (an Oxy-DB read), not by reaching the node.
 *
 * One node per user (`userId` unique). Re-registration (a newer signed `node`
 * record) upserts this row in place.
 */

/** How Oxy and the node move records: the node pulls (default), or Oxy pushes. */
export type UserNodeMode = 'pull' | 'push';

/**
 * Liveness state of the node:
 *  - `active`      — last probe reached the node's `/.well-known/oxy-node.json`.
 *  - `unreachable` — last probe failed (DNS/connect/timeout/non-2xx). The row is
 *    still served from cache; only the badge changes.
 *  - `revoked`     — the user removed the node registration. Excluded from the
 *    DID document and from liveness sweeps.
 */
export type UserNodeStatus = 'active' | 'unreachable' | 'revoked';

export interface IUserNode extends Document {
  /** The Oxy account that registered the node (one node per user). */
  userId: mongoose.Types.ObjectId;
  /** Optional DID the node advertises for itself (informational). */
  nodeDid?: string;
  /** The node's public HTTPS base URL (where its `/.well-known/oxy-node.json` lives). */
  endpoint: string;
  /** The node's secp256k1 public key (hex) — records it signs verify against this. */
  nodePublicKey: string;
  /** Transport direction. Defaults to `pull` (the node paces its own sync). */
  mode: UserNodeMode;
  /** Liveness badge — maintained only by background probes, never a read handler. */
  status: UserNodeStatus;
  /** Last time a probe reached the node successfully. */
  lastSeenAt?: Date;
  /** Last time a probe ran (success or failure). */
  lastProbeAt?: Date;
  /** Human-readable reason the last probe failed (cleared on success). */
  lastError?: string;
  /**
   * Last synced chain `seq` for the (future, F5b) two-way sync — how far Oxy and
   * the node have reconciled. Unused by F5a beyond being persisted.
   */
  cursor?: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserNodeSchema = new Schema<IUserNode>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    nodeDid: { type: String },
    endpoint: { type: String, required: true },
    nodePublicKey: { type: String, required: true },
    mode: { type: String, enum: ['pull', 'push'], required: true, default: 'pull' },
    status: { type: String, enum: ['active', 'unreachable', 'revoked'], required: true, default: 'active' },
    lastSeenAt: { type: Date },
    lastProbeAt: { type: Date },
    lastError: { type: String },
    cursor: { type: Number },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    strict: true,
    minimize: false,
  },
);

// Liveness sweeps scan by status (`active`/`unreachable`, never `revoked`).
UserNodeSchema.index({ status: 1 });

export const UserNode = mongoose.model<IUserNode>('UserNode', UserNodeSchema);
export default UserNode;
