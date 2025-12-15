import { IFile } from '../models/File';
import { User } from '../models/User';
import Block from '../models/Block';
import Restricted from '../models/Restricted';
import { logger } from '../utils/logger';
import { MediaAccessContext, MediaAccessResult } from '../types/mediaPrivacy.types';
import mongoose from 'mongoose';
import blockCache from '../utils/blockCache';
import userCache from '../utils/userCache';

export class MediaPrivacyService {
  /**
   * comprehensive access check for media files
   */
  async checkMediaAccess(
    file: IFile,
    viewerUserId?: string,
    context?: MediaAccessContext
  ): Promise<MediaAccessResult> {
    try {
      const ownerId = file.ownerUserId.toString();
      const isOwner = viewerUserId && ownerId === viewerUserId;

      if (isOwner) {
        return { allowed: true, reason: 'owner' };
      }

      if (file.visibility === 'public' && !context && !viewerUserId) {
        return { allowed: true, isPublic: true };
      }

      if (file.visibility === 'private' && !viewerUserId) {
        return { allowed: false, reason: 'authentication_required' };
      }

      if (viewerUserId) {
        const isBlocked = await this.isUserBlocked(ownerId, viewerUserId);
        if (isBlocked) {
          return { allowed: false, reason: 'blocked' };
        }

        if (file.visibility === 'public' && !context) {
          return { allowed: true, isPublic: true };
        }
      }

      if (file.visibility !== 'public' && file.visibility !== 'unlisted') {
        const ownerIdStr = ownerId;
        let owner = userCache.get(ownerIdStr);
        if (!owner) {
          const ownerDoc = await User.findById(ownerIdStr).select('privacySettings followers').lean();
          if (ownerDoc) {
            owner = ownerDoc as any;
            if (owner) {
              userCache.set(ownerIdStr, owner);
            }
          }
        }

        if (owner?.privacySettings?.isPrivateAccount) {
          if (!viewerUserId) {
            return { allowed: false, reason: 'private_account' };
          }
          
          const isFollowing = owner.followers?.some(id => id.toString() === viewerUserId);
          if (!isFollowing) {
            return { allowed: false, reason: 'not_following_private_account' };
          }
        }
      }

      if (context) {
        const entityAccess = await this.checkEntityAccess(context, viewerUserId);
        if (!entityAccess.allowed) {
          return { allowed: false, reason: 'entity_access_denied' };
        }
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Error in checkMediaAccess:', error);
      return { allowed: false, reason: 'error' };
    }
  }

  private async isUserBlocked(ownerId: string, viewerId: string): Promise<boolean> {
    const cached = blockCache.get(ownerId, viewerId);
    if (cached !== null) {
      return cached;
    }

    const [block, reverseBlock] = await Promise.all([
      Block.findOne({ userId: ownerId, blockedId: viewerId }).lean(),
      Block.findOne({ userId: viewerId, blockedId: ownerId }).lean()
    ]);

    const isBlocked = !!(block || reverseBlock);
    blockCache.set(ownerId, viewerId, isBlocked);
    return isBlocked;
  }

  /**
   * Check entity-level permissions
   */
  private async checkEntityAccess(
    context: MediaAccessContext,
    viewerUserId?: string
  ): Promise<{ allowed: boolean }> {
    const { postVisibility, authorId } = context;

    if (postVisibility) {
      if (postVisibility === 'public') return { allowed: true };
      if (postVisibility === 'private' && !viewerUserId) return { allowed: false };
      
      if (authorId && viewerUserId) {
        if (authorId === viewerUserId) return { allowed: true };
        
        if (postVisibility === 'followers') {
          const author = await User.findById(authorId).select('followers').lean();
          const isFollowing = author?.followers?.some(id => id.toString() === viewerUserId);
          return { allowed: !!isFollowing };
        }
      }
    }

    return { allowed: true };
  }
}

export const mediaPrivacyService = new MediaPrivacyService();

