/**
 * ChangeAvatarScreen — the single entry into changing a profile picture.
 *
 * Shows the current avatar large, then the four sources the user can pick from:
 * device gallery, camera, their existing Oxy files, and removing the current
 * photo. Every source that yields an image NAVIGATES WITHIN THIS SURFACE to
 * `AvatarCrop` (never presents it on top), so the panel morphs from this list's
 * size to the crop editor's and back — Cancel on the cropper returns here to
 * re-pick. One container reshaping, not two sheets. The forward morph is
 * flash-free because only the top frame renders and the cropper does all its own
 * async work (URL resolution + measurement), so this list is never left on screen
 * waiting.
 *
 * The surface resolves with an {@link AvatarCropResult} (the crop confirmed) or
 * an {@link AvatarRemovalResult} (the user removed their photo). This screen
 * performs NO writes: `useAvatarPicker` owns the single upload/removal path.
 *
 * `expo-image-picker` is an optional peer dependency — it is loaded with
 * `await import(...)` so an app that never changes avatars need not install it,
 * and a platform without a given source (camera on web) simply doesn't offer it.
 */

import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Avatar } from '@oxyhq/bloom/avatar';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import {
    AdmonitionRoot,
    AdmonitionRow,
    AdmonitionIcon,
    AdmonitionContent,
    AdmonitionText,
    AdmonitionButton,
} from '@oxyhq/bloom/admonition';
import { surfaces as bloomSurfaces } from '@oxyhq/bloom/surfaces';
import { useTheme } from '@oxyhq/bloom/theme';
import { toast } from '@oxyhq/bloom';
import { getAccountDisplayName, logger } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { useSurfaceHeader } from '../hooks/useSurfaceHeader';
import { openWithinOrPresent } from '../navigation/surfaces';
import { SettingsIcon } from '../components/SettingsIcon';
import type { BaseScreenProps } from '../types/navigation';

/** Component name used in `logger` context for filtered diagnostics. */
const LOG_COMPONENT = 'ChangeAvatarScreen';

/** Diameter (dp) of the current-avatar hero at the top of the screen. */
const PREVIEW_SIZE = 132;

/** MIME families the Oxy-files picker hides so it renders as an image-only picker. */
const NON_IMAGE_MIME_TYPES = ['video/', 'audio/', 'application/pdf'];

/**
 * The surface resolves with this when the user confirms removing their photo.
 * Distinguished from a crop result by the presence of `removed`, so the awaiting
 * caller narrows without a cast.
 */
export interface AvatarRemovalResult {
    removed: true;
}

/** Which permission was refused, so the screen can explain the right thing. */
type DeniedSource = 'library' | 'camera';

/**
 * The slice of `expo-image-picker` this screen uses. Declared locally (rather
 * than imported) because the module is an optional peer: a type-only import
 * would still make `tsc` require it to be installed.
 */
interface ImagePickerAsset {
    uri: string;
    width: number;
    height: number;
}

interface ImagePickerResult {
    canceled: boolean;
    assets: ImagePickerAsset[] | null;
}

interface ImagePickerPermission {
    granted: boolean;
    canAskAgain: boolean;
}

interface ImagePickerOptions {
    mediaTypes: 'images'[];
    allowsMultipleSelection: false;
    quality: number;
}

interface ImagePickerModule {
    launchImageLibraryAsync: (options: ImagePickerOptions) => Promise<ImagePickerResult>;
    launchCameraAsync: (options: ImagePickerOptions) => Promise<ImagePickerResult>;
    requestMediaLibraryPermissionsAsync: () => Promise<ImagePickerPermission>;
    requestCameraPermissionsAsync: () => Promise<ImagePickerPermission>;
}

/** Options shared by both launch paths — an image, one at a time, at full quality. */
const PICKER_OPTIONS: ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    // The crop editor downsamples to 512x512, so the source is taken untouched.
    quality: 1,
};

/**
 * Resolve `expo-image-picker` on demand. Returns `null` when the app has not
 * installed it, so the caller can explain that the source is unavailable rather
 * than crashing.
 */
async function loadImagePicker(): Promise<ImagePickerModule | null> {
    try {
        const mod = (await import('expo-image-picker')) as unknown as ImagePickerModule;
        if (typeof mod?.launchImageLibraryAsync !== 'function') return null;
        return mod;
    } catch (err) {
        logger.debug(
            'expo-image-picker unavailable',
            { component: LOG_COMPONENT },
            { reason: err instanceof Error ? err.message : String(err) },
        );
        return null;
    }
}

const ChangeAvatarScreen: React.FC<BaseScreenProps> = ({ navigate, dismiss }) => {
    const bloomTheme = useTheme();
    const { t, locale } = useI18n();
    const { user, oxyServices } = useOxy();

    /** Set when a permission was refused — drives the inline denied notice. */
    const [denied, setDenied] = useState<DeniedSource | null>(null);
    /** True while a source is being opened, so rows can't be double-fired. */
    const [busy, setBusy] = useState(false);

    useSurfaceHeader(useMemo(() => ({ title: t('changeAvatar.title') }), [t]));

    const displayName = useMemo(() => getAccountDisplayName(user, locale), [user, locale]);
    const avatarUri = useMemo(
        // `thumb` is 256x256 — exactly a 2x source for the 132dp hero.
        () => (user?.avatar ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb') : undefined),
        [user?.avatar, oxyServices],
    );

    /**
     * Hand a source to the crop editor by navigating WITHIN this surface (a push,
     * so Cancel on the cropper morphs back to this source list to re-pick). The
     * push is flash-free because only the top frame renders and the cropper does
     * ALL its own async work: the device / camera sources pass a ready `imageUri`;
     * the Oxy-files source passes only the file's `imageFileId`, which the cropper
     * resolves to a private-safe download URL itself (resolving it HERE would keep
     * this list on screen for the whole network round-trip — the flash the user
     * reported).
     */
    const goToCrop = useCallback(
        (cropProps: Record<string, unknown>) => {
            navigate?.('AvatarCrop', cropProps);
        },
        [navigate],
    );

    /**
     * Shared body of the two `expo-image-picker` sources. They differ only in
     * which permission they ask for and which launcher they call.
     */
    const pickFromDevice = useCallback(
        async (source: DeniedSource) => {
            if (busy) return;
            setBusy(true);
            try {
                const picker = await loadImagePicker();
                if (!picker) {
                    toast.error(
                        t(
                            source === 'camera'
                                ? 'changeAvatar.errors.cameraUnavailable'
                                : 'changeAvatar.errors.pickerUnavailable',
                        ),
                    );
                    return;
                }

                const permission =
                    source === 'camera'
                        ? await picker.requestCameraPermissionsAsync()
                        : await picker.requestMediaLibraryPermissionsAsync();
                if (!permission.granted) {
                    setDenied(source);
                    return;
                }
                setDenied(null);

                const result =
                    source === 'camera'
                        ? await picker.launchCameraAsync(PICKER_OPTIONS)
                        : await picker.launchImageLibraryAsync(PICKER_OPTIONS);
                const asset = result.canceled ? undefined : result.assets?.[0];
                if (!asset?.uri) return;

                // The picker reports the asset's natural size, so the crop editor
                // skips its own `Image.getSize` measurement round-trip.
                goToCrop({
                    imageUri: asset.uri,
                    sourceWidth: asset.width > 0 ? asset.width : undefined,
                    sourceHeight: asset.height > 0 ? asset.height : undefined,
                });
            } catch (err) {
                logger.error(
                    `${source} picker failed`,
                    err instanceof Error ? err : new Error(String(err)),
                    { component: LOG_COMPONENT },
                );
                toast.error(
                    t(
                        source === 'camera'
                            ? 'changeAvatar.errors.cameraFailed'
                            : 'changeAvatar.errors.pickFailed',
                    ),
                );
            } finally {
                setBusy(false);
            }
        },
        [busy, goToCrop, t],
    );

    /**
     * Pick from the files the user already has on Oxy. The image-only media
     * selector MORPHS into this surface (a nested sub-flow) like every other
     * screen and resolves with the chosen file; picking one then morphs on to the
     * crop editor. When triggered with no surface open it presents cold instead.
     */
    const pickFromOxyFiles = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const file = await openWithinOrPresent('FileManagement', {
                selectMode: true,
                multiSelect: false,
                disabledMimeTypes: NON_IMAGE_MIME_TYPES,
            });
            if (!file) return;

            if (!file.contentType?.startsWith('image/')) {
                toast.error(t('editProfile.toasts.selectImage'));
                return;
            }

            // Hand the file's ID straight to the cropper WITHOUT resolving its
            // (usually private) download URL here. The cropper resolves it — and
            // shows its own loading state on the dark canvas while it does — so
            // this source list is never left on screen for the network round-trip
            // that resolution takes (the "goes back to the avatar screen" flash).
            goToCrop({ imageFileId: file.id });
        } catch (err) {
            logger.error(
                'Oxy files pick failed',
                err instanceof Error ? err : new Error(String(err)),
                { component: LOG_COMPONENT },
            );
            toast.error(t('changeAvatar.errors.loadImageFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, goToCrop, t]);

    /** Confirm, then resolve the surface with the removal so the caller writes it. */
    const removeCurrentPhoto = useCallback(async () => {
        const confirmed = await bloomSurfaces.confirm({
            title: t('changeAvatar.remove.confirmTitle'),
            message: t('changeAvatar.remove.confirmMessage'),
            confirmLabel: t('changeAvatar.remove.confirmLabel'),
            cancelLabel: t('common.cancel'),
            destructive: true,
        });
        if (!confirmed) return;
        const removal: AvatarRemovalResult = { removed: true };
        dismiss?.(removal);
    }, [dismiss, t]);

    const openSystemSettings = useCallback(() => {
        void Linking.openSettings();
    }, []);

    // The camera is a native-only source: on web `launchCameraAsync` has no
    // meaningful surface to open, so the row is not offered at all.
    const canUseCamera = Platform.OS !== 'web';

    return (
        <View className="px-screen-margin pt-space-8 pb-space-24 gap-space-16">
            <View className="items-center" accessible accessibilityRole="image"
                accessibilityLabel={t('changeAvatar.a11y.currentPhoto')}>
                <Avatar source={avatarUri} name={displayName} size={PREVIEW_SIZE} />
            </View>

            {denied ? (
                <AdmonitionRoot type="warning">
                    <AdmonitionRow>
                        <AdmonitionIcon />
                        <AdmonitionContent>
                            <AdmonitionText>
                                {t(
                                    denied === 'camera'
                                        ? 'changeAvatar.permission.cameraDenied'
                                        : 'changeAvatar.permission.libraryDenied',
                                )}
                            </AdmonitionText>
                            {Platform.OS === 'web' ? null : (
                                <AdmonitionButton onPress={openSystemSettings}>
                                    {t('changeAvatar.permission.openSettings')}
                                </AdmonitionButton>
                            )}
                        </AdmonitionContent>
                    </AdmonitionRow>
                </AdmonitionRoot>
            ) : null}

            <SettingsListGroup>
                <SettingsListItem
                    icon={<SettingsIcon name="image-outline" color={bloomTheme.colors.primary} />}
                    title={t('changeAvatar.sources.upload.title')}
                    description={t('changeAvatar.sources.upload.description')}
                    disabled={busy}
                    onPress={() => void pickFromDevice('library')}
                />
                {canUseCamera ? (
                    <SettingsListItem
                        icon={<SettingsIcon name="camera-outline" color={bloomTheme.colors.info} />}
                        title={t('changeAvatar.sources.camera.title')}
                        description={t('changeAvatar.sources.camera.description')}
                        disabled={busy}
                        onPress={() => void pickFromDevice('camera')}
                    />
                ) : null}
                <SettingsListItem
                    icon={<SettingsIcon name="folder-image" color={bloomTheme.colors.success} />}
                    title={t('changeAvatar.sources.files.title')}
                    description={t('changeAvatar.sources.files.description')}
                    disabled={busy}
                    onPress={() => void pickFromOxyFiles()}
                />
                <SettingsListItem
                    icon={<SettingsIcon name="trash-can-outline" color={bloomTheme.colors.error} />}
                    title={t('changeAvatar.sources.remove.title')}
                    description={t('changeAvatar.sources.remove.description')}
                    destructive
                    disabled={busy || !user?.avatar}
                    onPress={() => void removeCurrentPhoto()}
                />
            </SettingsListGroup>
        </View>
    );
};

export default ChangeAvatarScreen;
