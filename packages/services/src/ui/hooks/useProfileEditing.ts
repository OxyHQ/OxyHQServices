import { useState, useCallback } from 'react';
import { useOxy } from '../context/OxyContext';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../../lib/sonner';
import { useI18n } from './useI18n';

export interface ProfileUpdateData {
    displayName?: string;
    lastName?: string;
    username?: string;
    email?: string;
    bio?: string;
    location?: string;
    locations?: Array<{
        id: string;
        name: string;
        label?: string;
        coordinates?: { lat: number; lon: number };
    }>;
    links?: string[];
    linksMetadata?: Array<{
        url: string;
        title?: string;
        description?: string;
        image?: string;
        id: string;
    }>;
    avatar?: string;
}

/**
 * Hook for managing profile editing operations
 * Provides functions to update profile fields and handle saving
 */
export const useProfileEditing = () => {
    const { oxyServices, activeSessionId } = useOxy();
    const updateUser = useAuthStore((state) => state.updateUser);
    const { t } = useI18n();
    const [isSaving, setIsSaving] = useState(false);

    /**
     * Save profile updates to the server
     */
    const saveProfile = useCallback(async (updates: ProfileUpdateData) => {
        if (!oxyServices) {
            toast.error(t('editProfile.toasts.serviceUnavailable') || 'Service not available');
            return false;
        }

        try {
            setIsSaving(true);

            // Prepare update object
            const updateData: Record<string, any> = {};

            if (updates.username !== undefined) {
                updateData.username = updates.username;
            }
            if (updates.email !== undefined) {
                updateData.email = updates.email;
            }
            if (updates.bio !== undefined) {
                updateData.bio = updates.bio;
            }
            if (updates.location !== undefined || updates.locations !== undefined) {
                updateData.location = updates.locations && updates.locations.length > 0 
                    ? updates.locations[0].name 
                    : updates.location || '';
                if (updates.locations) {
                    updateData.locations = updates.locations;
                }
            }
            if (updates.links !== undefined) {
                updateData.links = updates.links;
            }
            if (updates.linksMetadata !== undefined) {
                updateData.linksMetadata = updates.linksMetadata;
            }
            if (updates.avatar !== undefined) {
                updateData.avatar = updates.avatar;
            }

            // Handle name field
            if (updates.displayName !== undefined || updates.lastName !== undefined) {
                const currentUser = useAuthStore.getState().user;
                const currentName = currentUser?.name;
                updateData.name = {
                    first: updates.displayName ?? (typeof currentName === 'object' ? currentName?.first : '') ?? '',
                    last: updates.lastName ?? (typeof currentName === 'object' ? currentName?.last : '') ?? '',
                };
            }

            await updateUser(updateData, oxyServices);
            toast.success(t('editProfile.toasts.profileUpdated') || 'Profile updated successfully');
            return true;
        } catch (error: any) {
            console.error('Failed to update profile:', error);
            toast.error(error?.message || t('editProfile.toasts.updateFailed') || 'Failed to update profile');
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [oxyServices, updateUser, t]);

    /**
     * Update a single profile field
     */
    const updateField = useCallback(async (field: string, value: any) => {
        const updates: ProfileUpdateData = {};
        
        switch (field) {
            case 'displayName':
                updates.displayName = value;
                break;
            case 'username':
                updates.username = value;
                break;
            case 'email':
                updates.email = value;
                break;
            case 'bio':
                updates.bio = value;
                break;
            case 'location':
                updates.locations = value;
                break;
            case 'links':
                updates.linksMetadata = value;
                updates.links = value.map((link: any) => link.url || link);
                break;
            default:
                return false;
        }

        return await saveProfile(updates);
    }, [saveProfile]);

    return {
        saveProfile,
        updateField,
        isSaving,
    };
};








