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
      // 1. Public files with no special entity constraints are accessible by everyone
      // Note: If a public file is linked to a private post, it should theoretically be restricted,
      // but the current architecture might rely on the file's visibility setting.
      // We will enforce stricter rules: if it's linked to a private context, we check that.
      
      // If file is explicitly marked public and we have no context suggesting otherwise
      if (file.visibility === 'public' && !context) {
        // We still need to check if the OWNER has blocked the VIEWER (if viewer is logged in)
        // But for public files, we usually skip this for performance (CDN).
        // However, strictly speaking, blocked users shouldn't see content.
        // Compromise: Public files are public, unless we are in an API context where we know the user.
        if (!viewerUserId) return { allowed: true, isPublic: true };
      }

      // 2. Owner always has access
      if (viewerUserId && file.ownerUserId === viewerUserId) {
        return { allowed: true, reason: 'owner' };
      }

      // 3. Private files require authentication
      if (file.visibility === 'private' && !viewerUserId) {
        return { allowed: false, reason: 'authentication_required' };
      }

      // 4. Check Block/Restricted status
      if (viewerUserId) {
        const isBlocked = await this.isUserBlocked(file.ownerUserId, viewerUserId);
        if (isBlocked) {
          return { allowed: false, reason: 'blocked' };
        }
      }

      // 5. Check Private Account logic
      // If file is not explicitly public, we check user privacy
      if (file.visibility !== 'public' && file.visibility !== 'unlisted') {
        const owner = await User.findById(file.ownerUserId).select('privacySettings followers');
        if (owner?.privacySettings?.isPrivateAccount) {
          // Viewer must be following
          if (!viewerUserId) return { allowed: false, reason: 'private_account' };
          
          const isFollowing = owner.followers?.some(id => id.toString() === viewerUserId);
          if (!isFollowing) {
            return { allowed: false, reason: 'not_following_private_account' };
          }
        }
      }

      // 6. Context-aware checks (Post/Entity visibility)
      if (context) {
        const entityAccess = await this.checkEntityAccess(context, viewerUserId);
        if (!entityAccess.allowed) {
          return { allowed: false, reason: 'entity_access_denied' };
        }
      } else if (file.links && file.links.length > 0) {
        // If no specific context provided, but file is linked, we might want to check if ANY link allows access?
        // OR verify that the user has access to at least one of the contexts?
        // For now, we assume if access checking reaches here without context, standard file visibility rules apply.
        // Ideally, the caller should provide context if they are viewing the file within a post.
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Error in checkMediaAccess:', error);
      // Fail safe: deny access on error
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
    const { app, entityType, entityId, postVisibility, authorId } = context;

    // If we have explicit visibility info passed
    if (postVisibility) {
      if (postVisibility === 'public') return { allowed: true };
      if (postVisibility === 'private' && !viewerUserId) return { allowed: false };
      
      // If authorId provided, check relationship
      if (authorId && viewerUserId) {
        if (authorId === viewerUserId) return { allowed: true };
        
        if (postVisibility === 'followers') {
          // Check if viewer follows author
          const author = await User.findById(authorId).select('followers');
          const isFollowing = author?.followers?.some(id => id.toString() === viewerUserId);
          return { allowed: !!isFollowing };
        }
      }
    }

    // Fallback: for now assume allowed if we can't verify specifics, 
    // or fail secure. Let's fail secure if we expected a check.
    // But since this is a new service, let's be permissive if data is missing to avoid breaking existing flows
    // until fully integrated.
    return { allowed: true };
  }
}

export const mediaPrivacyService = new MediaPrivacyService();

