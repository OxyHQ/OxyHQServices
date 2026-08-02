/**
 * Backfill plans for the file manager, the mail store and their neighbours.
 *
 * This group holds the two largest collections in production — `files`
 * (296,924 documents) and `linkpreviews` (75,172) — and the two widest
 * decompositions, so the traps concentrate here.
 *
 * ## `files.owner_user_id` no longer holds sentinels
 *
 * Mongo stored three system-namespace STRINGS in `ownerUserId`, a field that
 * otherwise holds user ids, which is why the column could never carry a foreign
 * key. Postgres splits them: `owner_user_id` references `users.id`,
 * `system_owner` names the namespace, and a CHECK asserts exactly one is set.
 * The discriminator is the `__`-prefix — an ObjectId hex can never start with
 * an underscore, so it is exact rather than a mapping table.
 *
 * A sentinel that is not one of the three declared values is a THROW, not a
 * silent pass-through: it would fail `files_system_owner_check` at insert time
 * naming only the constraint, and the whole point of doing it here is to name
 * the document.
 *
 * ## Three collections whose Mongo counters do not travel
 *
 * `mailboxes` kept `totalMessages`, `unseenMessages` and `size` current through
 * eighteen `$inc` sites. Postgres computes all three from `messages`. There is
 * nothing to map — and nothing lost, because the numbers are the same numbers.
 *
 * ## `linkpreviews._id` is content-addressed
 *
 * It is the SHA-256 of the normalized URL and is always supplied by the caller,
 * so `link_previews.id` is a plain `text().primaryKey()` with no generator. The
 * backfill supplies it verbatim like every other id; the only difference is
 * that this one is not an ObjectId hex, which is exactly why the id columns are
 * `text` rather than anything narrower.
 */

import {
  bundles,
  emailFilterActions,
  emailFilterConditions,
  emailFilters,
  emailTemplates,
  federationKeyPairs,
  fileLinks,
  fileVariants,
  files,
  FILE_SYSTEM_OWNERS,
  labels,
  linkPreviews,
  mailboxes,
  messageAttachments,
  messageRecipients,
  messages,
  reminders,
  senderAvatars,
  topics,
} from '../../schema';
import type { CollectionPlan, Emit } from '../plan';
import { DROP_UNRENDERABLE_MESSAGE_CARD, resolveMessageCard } from '../resolutions';
import { buildRow } from '../rowBuilder';
import {
  BackfillValueError,
  childRowId,
  bool,
  date,
  describeId,
  id,
  int,
  jsonArray,
  jsonObject,
  num,
  ownId,
  reqDate,
  reqId,
  reqInt,
  reqNum,
  reqStr,
  str,
  strArray,
  subdocuments,
  type MongoDocument,
} from '../values';

/**
 * Split Mongo's single `ownerUserId` into the account column and the system
 * namespace column, per `schema/files.ts`.
 *
 * The `__` test is the whole mapping. A value that starts with `__` but is not
 * one of the three declared namespaces throws: it means a fourth sentinel was
 * introduced without the schema learning about it, and a CHECK violation three
 * hours into a production run would name the constraint rather than the row.
 */
function splitFileOwner(doc: MongoDocument): {
  ownerUserId: string | null;
  systemOwner: string | null;
} {
  const owner = reqId(doc, 'ownerUserId');
  if (!owner.startsWith('__')) return { ownerUserId: owner, systemOwner: null };

  const declared: readonly string[] = FILE_SYSTEM_OWNERS;
  if (!declared.includes(owner)) {
    throw new BackfillValueError(
      'ownerUserId',
      `is the system-owner sentinel ${JSON.stringify(owner)}, which is not one ` +
        `of the three FILE_SYSTEM_OWNERS the schema declares ` +
        `(${declared.join(', ')}). files_system_owner_check would reject this row`,
      describeId(doc)
    );
  }
  return { ownerUserId: null, systemOwner: owner };
}

/** Rows for `message_recipients` from one of the three address arrays. */
function emitRecipients(
  doc: MongoDocument,
  messageDocumentId: string,
  path: 'to' | 'cc' | 'bcc',
  emit: Emit
): void {
  for (const [entry, ordinal] of subdocuments(doc, path)) {
    emit(
      messageRecipients,
      buildRow(
        messageRecipients,
        {
          messageId: messageDocumentId,
          kind: path,
          ord: ordinal,
          name: str(entry, 'name'),
          address: reqStr(entry, 'address'),
        },
        messageDocumentId
      )
    );
  }
}

export const EMAIL_FILES_PLANS: readonly CollectionPlan[] = [
  // -------------------------------------------------------------------------
  // files — the largest collection, and the sentinel-owner split
  // -------------------------------------------------------------------------
  {
    collection: 'files',
    table: files,
    childTables: [fileLinks, fileVariants],
    enumAudits: [
      { path: 'status', column: files.status, absentAs: 'active' },
      { path: 'visibility', column: files.visibility, absentAs: 'private' },
      { path: 'purpose', column: files.purpose, absentAs: 'user' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      const { ownerUserId, systemOwner } = splitFileOwner(doc);

      emit(
        files,
        buildRow(
          files,
          {
            id: documentId,
            sha256: reqStr(doc, 'sha256'),
            size: reqNum(doc, 'size'),
            mime: reqStr(doc, 'mime'),
            ext: reqStr(doc, 'ext'),
            ownerUserId,
            systemOwner,
            status: str(doc, 'status') ?? 'active',
            visibility: str(doc, 'visibility') ?? 'private',
            purpose: str(doc, 'purpose') ?? 'user',
            storageKey: reqStr(doc, 'storageKey'),
            originalName: str(doc, 'originalName'),
            metadata: jsonObject(doc, 'metadata'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // `links` — Mongo indexed four of its five inner fields individually, so
      // it was already a table wearing an array's clothes. `_id: false` on the
      // subschema means these rows have no id of their own to preserve, so
      // `childRowId` DERIVES one from the file and the ordinal. A freshly
      // generated uuid would differ on every run; this one does not, which is
      // what lets `ON CONFLICT DO NOTHING` recognise the row on a re-run.
      for (const [link, ordinal] of subdocuments(doc, 'links')) {
        emit(
          fileLinks,
          buildRow(
            fileLinks,
            {
              id: childRowId(link, documentId, 'links', ordinal),
              fileId: documentId,
              app: reqStr(link, 'app'),
              entityType: reqStr(link, 'entityType'),
              entityId: reqStr(link, 'entityId'),
              createdBy: reqId(link, 'createdBy'),
              webhookUrl: str(link, 'webhookUrl'),
              createdAt: date(link, 'createdAt') ?? new Date(0),
            },
            documentId
          )
        );
      }

      // `variants` — deliberately NO unique on (file_id, type): a regeneration
      // is a delete-then-insert, so two rows for one type is a legitimate
      // intermediate state (see `schema/fileVariants.ts`).
      //
      // That makes this the ONE child table where a random id would break
      // idempotence outright: with no unique constraint to conflict on, a second
      // run would insert a duplicate of every variant and nothing would notice.
      // The DERIVED id is the primary key it conflicts on instead.
      for (const [variant, ordinal] of subdocuments(doc, 'variants')) {
        emit(
          fileVariants,
          buildRow(
            fileVariants,
            {
              id: childRowId(variant, documentId, 'variants', ordinal),
              fileId: documentId,
              type: reqStr(variant, 'type'),
              key: reqStr(variant, 'key'),
              width: int(variant, 'width'),
              height: int(variant, 'height'),
              readyAt: date(variant, 'readyAt'),
              size: num(variant, 'size'),
              metadata: jsonObject(variant, 'metadata'),
            },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // messages — the widest table, and two child decompositions
  // -------------------------------------------------------------------------
  {
    collection: 'messages',
    table: messages,
    childTables: [messageRecipients, messageAttachments],
    enumAudits: [
      {
        path: 'card.type',
        column: messages.cardType,
        // ~13 production documents hold a card METADATA OBJECT here. The card
        // is dropped and the message kept — see the rule for why that costs
        // nothing, and `resolveMessageCard` for how narrow it is.
        resolvedBy: DROP_UNRENDERABLE_MESSAGE_CARD,
      },
    ],
    transform(doc, emit, resolutions) {
      const documentId = ownId(doc);

      // `card` is all-or-nothing: `messages_card_complete_check` asserts the
      // four columns are either all set or all null, because a card with a type
      // and no data is not a card. Mongo could represent the half state; the
      // transform reads the presence of the embedded object, not of one field.
      //
      // `resolveMessageCard` then applies the ONE documented degradation: a
      // card whose `type` is not one of the five the column declares is
      // dropped (and reported by id), because no client can render it and
      // refusing the row would lose a real message.
      const card = resolveMessageCard(documentId, jsonObject(doc, 'card'), resolutions);
      const cardColumns =
        card === null
          ? { cardType: null, cardData: null, cardConfidence: null, cardExtractedAt: null }
          : {
              cardType: reqStr(card, 'type'),
              cardData: jsonObject(card, 'data') ?? {},
              cardConfidence: reqNum(card, 'confidence'),
              cardExtractedAt: reqDate(card, 'extractedAt'),
            };

      // `replyTo` is the same shape of pair — `messages_reply_to_complete_check`
      // requires an address whenever a name is present.
      const replyTo = jsonObject(doc, 'replyTo');

      emit(
        messages,
        buildRow(
          messages,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            mailboxId: reqId(doc, 'mailboxId'),
            messageId: reqStr(doc, 'messageId'),
            fromName: str(doc, 'from.name'),
            fromAddress: reqStr(doc, 'from.address'),
            replyToName: replyTo === null ? null : str(replyTo, 'name'),
            replyToAddress: replyTo === null ? null : str(replyTo, 'address'),
            subject: str(doc, 'subject') ?? '',
            text: str(doc, 'text'),
            html: str(doc, 'html'),
            headers: jsonObject(doc, 'headers') ?? {},
            encryptedBody: str(doc, 'encryptedBody'),
            // `flags` was an embedded object with six booleans; each is a real
            // column now, three of them with a partial index behind them.
            seen: bool(doc, 'flags.seen') ?? false,
            starred: bool(doc, 'flags.starred') ?? false,
            answered: bool(doc, 'flags.answered') ?? false,
            forwarded: bool(doc, 'flags.forwarded') ?? false,
            draft: bool(doc, 'flags.draft') ?? false,
            pinned: bool(doc, 'flags.pinned') ?? false,
            labels: strArray(doc, 'labels') ?? [],
            ...cardColumns,
            highlights: jsonArray(doc, 'highlights') ?? [],
            encrypted: bool(doc, 'encrypted') ?? false,
            spamScore: num(doc, 'spamScore'),
            spamAction: str(doc, 'spamAction'),
            size: reqNum(doc, 'size'),
            inReplyTo: str(doc, 'inReplyTo'),
            references: strArray(doc, 'references') ?? [],
            aliasTag: str(doc, 'aliasTag'),
            snoozedUntil: date(doc, 'snoozedUntil'),
            snoozedFromMailbox: id(doc, 'snoozedFromMailbox'),
            scheduledAt: date(doc, 'scheduledAt'),
            readReceiptRequested: bool(doc, 'readReceiptRequested') ?? false,
            readReceiptSent: bool(doc, 'readReceiptSent') ?? false,
            date: reqDate(doc, 'date'),
            // Mongo defaulted `receivedAt` to now at write time; a document
            // written before the field existed falls back to the Date header,
            // which is the only other instant the row actually knows.
            receivedAt: date(doc, 'receivedAt') ?? reqDate(doc, 'date'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // Three arrays, one table, discriminated by `kind`. The ordinal is per
      // KIND (the unique is `(message_id, kind, ord)`), so each array restarts
      // at 0 — header order within To: is the contract, order across To:/Cc: is
      // not a thing.
      emitRecipients(doc, documentId, 'to', emit);
      emitRecipients(doc, documentId, 'cc', emit);
      emitRecipients(doc, documentId, 'bcc', emit);

      for (const [attachment, ordinal] of subdocuments(doc, 'attachments')) {
        emit(
          messageAttachments,
          buildRow(
            messageAttachments,
            {
              messageId: documentId,
              ord: ordinal,
              fileId: reqId(attachment, 'fileId'),
              name: reqStr(attachment, 'name'),
              contentType: reqStr(attachment, 'contentType'),
              size: reqNum(attachment, 'size'),
              contentId: str(attachment, 'contentId'),
              isInline: bool(attachment, 'isInline') ?? false,
            },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // mailboxes — the three counters deliberately do not travel
  // -------------------------------------------------------------------------
  {
    collection: 'mailboxes',
    table: mailboxes,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        mailboxes,
        buildRow(
          mailboxes,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            name: reqStr(doc, 'name'),
            path: reqStr(doc, 'path'),
            specialUse: str(doc, 'specialUse'),
            retentionDays: int(doc, 'retentionDays'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // the three case-insensitive-unique tables
  // -------------------------------------------------------------------------
  {
    collection: 'labels',
    table: labels,
    uniquenessAudits: [
      {
        index: 'labels_user_id_lower_name_key',
        key: [
          { path: 'userId', normalize: 'exact' },
          { path: 'name', normalize: 'lower' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        labels,
        buildRow(
          labels,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            name: reqStr(doc, 'name'),
            color: str(doc, 'color') ?? '#4285f4',
            order: int(doc, 'order') ?? 0,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'bundles',
    table: bundles,
    uniquenessAudits: [
      {
        index: 'bundles_user_id_lower_name_key',
        key: [
          { path: 'userId', normalize: 'exact' },
          { path: 'name', normalize: 'lower' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        bundles,
        buildRow(
          bundles,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            name: reqStr(doc, 'name'),
            icon: str(doc, 'icon') ?? 'folder-outline',
            color: str(doc, 'color') ?? '#5F6368',
            matchLabels: strArray(doc, 'matchLabels') ?? [],
            enabled: bool(doc, 'enabled') ?? true,
            collapsed: bool(doc, 'collapsed') ?? true,
            order: int(doc, 'order') ?? 0,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'emailtemplates',
    table: emailTemplates,
    uniquenessAudits: [
      {
        index: 'email_templates_user_id_lower_name_key',
        key: [
          { path: 'userId', normalize: 'exact' },
          { path: 'name', normalize: 'lower' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        emailTemplates,
        buildRow(
          emailTemplates,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            name: reqStr(doc, 'name'),
            subject: str(doc, 'subject') ?? '',
            body: reqStr(doc, 'body'),
            order: int(doc, 'order') ?? 0,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // email filters — two ordered child lists
  // -------------------------------------------------------------------------
  {
    collection: 'emailfilters',
    table: emailFilters,
    childTables: [emailFilterConditions, emailFilterActions],
    enumAudits: [
      { path: 'conditions.field', column: emailFilterConditions.field },
      { path: 'conditions.operator', column: emailFilterConditions.operator },
      { path: 'actions.type', column: emailFilterActions.type },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        emailFilters,
        buildRow(
          emailFilters,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            name: reqStr(doc, 'name'),
            enabled: bool(doc, 'enabled') ?? true,
            matchAll: bool(doc, 'matchAll') ?? true,
            order: int(doc, 'order') ?? 0,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // `ord` is the array index and it is load-bearing: conditions are
      // evaluated and actions APPLIED in order, so a set is not the same
      // object. `(filter_id, ord)` is unique for exactly that reason.
      for (const [condition, ordinal] of subdocuments(doc, 'conditions')) {
        emit(
          emailFilterConditions,
          buildRow(
            emailFilterConditions,
            {
              filterId: documentId,
              ord: ordinal,
              field: reqStr(condition, 'field'),
              operator: reqStr(condition, 'operator'),
              value: reqStr(condition, 'value'),
            },
            documentId
          )
        );
      }

      for (const [action, ordinal] of subdocuments(doc, 'actions')) {
        emit(
          emailFilterActions,
          buildRow(
            emailFilterActions,
            {
              filterId: documentId,
              ord: ordinal,
              type: reqStr(action, 'type'),
              value: str(action, 'value'),
            },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // the rest of the mail store
  // -------------------------------------------------------------------------
  {
    collection: 'senderavatars',
    table: senderAvatars,
    enumAudits: [{ path: 'source', column: senderAvatars.source }],
    uniquenessAudits: [
      {
        index: 'sender_avatars_email_key',
        key: [
          { path: 'email', normalize: 'exact' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        senderAvatars,
        buildRow(
          senderAvatars,
          {
            id: documentId,
            email: reqStr(doc, 'email'),
            avatarPath: str(doc, 'avatarPath'),
            source: reqStr(doc, 'source'),
            resolvedAt: date(doc, 'resolvedAt') ?? new Date(0),
            expiresAt: reqDate(doc, 'expiresAt'),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'reminders',
    table: reminders,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        reminders,
        buildRow(
          reminders,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            text: reqStr(doc, 'text'),
            remindAt: reqDate(doc, 'remindAt'),
            completed: bool(doc, 'completed') ?? false,
            pinned: bool(doc, 'pinned') ?? false,
            snoozedUntil: date(doc, 'snoozedUntil'),
            relatedMessageId: id(doc, 'relatedMessageId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // link previews — the one content-addressed primary key
  // -------------------------------------------------------------------------
  {
    collection: 'linkpreviews',
    table: linkPreviews,
    enumAudits: [{ path: 'status', column: linkPreviews.status, absentAs: 'pending' }],
    transform(doc, emit) {
      // `_id` is the SHA-256 of the normalized URL, not an ObjectId. It is
      // still copied verbatim — `ownId` does not care which it is, which is
      // the property that makes `text` the right id type.
      const documentId = ownId(doc);
      emit(
        linkPreviews,
        buildRow(
          linkPreviews,
          {
            id: documentId,
            requestedUrl: reqStr(doc, 'requestedUrl'),
            canonicalUrl: reqStr(doc, 'canonicalUrl'),
            title: str(doc, 'title'),
            description: str(doc, 'description'),
            siteName: str(doc, 'siteName'),
            favicon: str(doc, 'favicon'),
            imageUrl: str(doc, 'imageUrl'),
            // Server-only: a PROTECTED column. Serializing it would leak the
            // viewer's IP to the origin — see `protectedColumns.ts`.
            originImageUrl: str(doc, 'originImageUrl'),
            originFaviconUrl: str(doc, 'originFaviconUrl'),
            status: str(doc, 'status') ?? 'pending',
            version: int(doc, 'version') ?? 0,
            resolvedAt: date(doc, 'resolvedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // topics
  // -------------------------------------------------------------------------
  {
    collection: 'topics',
    table: topics,
    enumAudits: [
      { path: 'type', column: topics.type },
      { path: 'source', column: topics.source },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        topics,
        buildRow(
          topics,
          {
            id: documentId,
            name: reqStr(doc, 'name'),
            slug: reqStr(doc, 'slug'),
            displayName: reqStr(doc, 'displayName'),
            description: str(doc, 'description'),
            type: reqStr(doc, 'type'),
            source: reqStr(doc, 'source'),
            aliases: strArray(doc, 'aliases') ?? [],
            // Self-referencing: deferred to the second pass by the runner.
            parentTopicId: id(doc, 'parentTopicId'),
            icon: str(doc, 'icon'),
            image: str(doc, 'image'),
            isActive: bool(doc, 'isActive') ?? true,
            // A Mongo `Map` of locale → {displayName, description}. Genuinely
            // shape-less at the key level (one entry per locale), so jsonb.
            translations: jsonObject(doc, 'translations'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // federation key pairs — the one collection with no file in `models/`
  // -------------------------------------------------------------------------
  {
    // Declared with an explicit third argument to `mongoose.model` inside
    // `services/federation.service.ts`, so the live name is NOT the pluralised
    // model name and NOT the table name. This is precisely why the map is read
    // from `db.listCollections()` rather than derived from either side.
    collection: 'federation_keypairs',
    table: federationKeyPairs,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        federationKeyPairs,
        buildRow(
          federationKeyPairs,
          {
            id: documentId,
            keyId: reqStr(doc, 'keyId'),
            publicKeyPem: reqStr(doc, 'publicKeyPem'),
            // PROTECTED: the live signing key for a federated identity.
            privateKeyPem: reqStr(doc, 'privateKeyPem'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },
];
