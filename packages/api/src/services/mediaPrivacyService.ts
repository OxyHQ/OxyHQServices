import { IFile } from '../models/File';
import { User } from '../models/User';
import Block from '../models/Block';
import Restricted from '../models/Restricted';
import { logger } from '../utils/logger';
import { MediaAccessContext, MediaAccessResult } from '../types/mediaPrivacy.types';
import mongoose from 'mongoose';

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
      // Fast path: Public files without context - allow immediately
      if (file.visibility === 'public' && !context && !viewerUserId) {
        return { allowed: true, isPublic: true };
      }

      // Owner always has access
      if (viewerUserId && file.ownerUserId.toString() === viewerUserId) {
        return { allowed: true, reason: 'owner' };
      }

      // Private files require authentication
      if (file.visibility === 'private' && !viewerUserId) {
        return { allowed: false, reason: 'authentication_required' };
      }

      // Public files with viewer - check block status
      if (file.visibility === 'public' && viewerUserId && !context) {
        const isBlocked = await this.isUserBlocked(file.ownerUserId.toString(), viewerUserId);
        if (isBlocked) {
          return { allowed: false, reason: 'blocked' };
        }
        return { allowed: true, isPublic: true };
      }

      // Check Block/Restricted status for non-public files
      if (viewerUserId && file.visibility !== 'public') {
        const isBlocked = await this.isUserBlocked(file.ownerUserId.toString(), viewerUserId);
        if (isBlocked) {
          return { allowed: false, reason: 'blocked' };
        }
      }

      // Check Private Account logic (only for non-public files)
      if (file.visibility !== 'public' && file.visibility !== 'unlisted') {
        const owner = await User.findById(file.ownerUserId).select('privacySettings followers').lean();
        if (owner?.privacySettings?.isPrivateAccount) {
          if (!viewerUserId) return { allowed: false, reason: 'private_account' };
          
          const isFollowing = owner.followers?.some(id => id.toString() === viewerUserId);
          if (!isFollowing) {
            return { allowed: false, reason: 'not_following_private_account' };
          }
        }
      }

      // Context-aware checks
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

  /**
   * Check if viewer is blocked by owner
   */
  private async isUserBlocked(ownerId: string, viewerId: string): Promise<boolean> {
    // Check if owner blocked viewer
    const block = await Block.findOne({ userId: ownerId, blockedId: viewerId });
    if (block) return true;

    // Check if viewer blocked owner (optional, usually we hide content both ways)
    const reverseBlock = await Block.findOne({ userId: viewerId, blockedId: ownerId });
    if (reverseBlock) return true;

    return false;
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

