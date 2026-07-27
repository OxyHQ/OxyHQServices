/**
 * Resolve an OAuth `clientId` (`ApplicationCredential.publicKey`) to the active
 * `Application` it belongs to. Returns null when the credential is unknown,
 * revoked / out of its rotation grace, or its application is not active.
 */

import type mongoose from 'mongoose';
import { Application } from '../models/Application';
import { ApplicationCredential } from '../models/ApplicationCredential';
import { isCredentialUsable } from './credentialUsability';

export async function resolveApplicationIdFromClientId(
  clientId: string,
): Promise<mongoose.Types.ObjectId | null> {
  const credential = await ApplicationCredential.findOne({ publicKey: clientId });
  if (!credential || !isCredentialUsable(credential)) {
    return null;
  }

  const application = await Application.findById(credential.applicationId);
  if (!application || application.status !== 'active') {
    return null;
  }

  return application._id;
}
