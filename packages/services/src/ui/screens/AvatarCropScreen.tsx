/**
 * AvatarCropScreen
 *
 * Square-crop editor presented after the user picks an image but before the
 * avatar is uploaded. Renders the source image inside a fixed square viewport
 * with pan + pinch gestures (Reanimated + Gesture Handler — already on the
 * services dependency graph), and then calls `expo-image-manipulator` to
 * produce a 512x512 JPEG before invoking `onConfirm` with the cropped file.
 *
 * `expo-image-manipulator` is an optional peer dependency — it is loaded with
 * `await import(...)` and a clear error is surfaced if the consuming app has
 * not installed it.
 */

import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    TouchableOpacity,
    Image,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@oxyhq/bloom/theme';
import { Header } from '../components';
import { fontFamilies } from '../styles/fonts';
import { useI18n } from '../hooks/useI18n';
import { toast } from '../../lib/sonner';
import type { BaseScreenProps } from '../types/navigation';

/** Final crop result handed back to the caller. */
export interface AvatarCropResult {
    /** File URI to the cropped 512x512 JPEG on disk. */
    uri: string;
    /** Output width (always 512). */
    width: number;
    /** Output height (always 512). */
    height: number;
    /** MIME type (always `image/jpeg`). */
    mime: 'image/jpeg';
}

export interface AvatarCropScreenProps extends BaseScreenProps {
    /** URI of the source image to crop. */
    imageUri?: string;
    /** Natural width of the source image (optional — measured if absent). */
    sourceWidth?: number;
    /** Natural height of the source image (optional — measured if absent). */
    sourceHeight?: number;
    /** Called with the cropped file once the user confirms. */
    onConfirm?: (result: AvatarCropResult) => void | Promise<void>;
    /** Called if the user cancels without confirming. */
    onCancel?: () => void;
}

/** Side length (in dp) of the crop viewport. The output is always 512x512px. */
const VIEWPORT_SIZE = 320;
const OUTPUT_SIZE = 512;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

/**
 * Clamp the translation so the image edges never leave the viewport at any
 * scale. Worklet-friendly (pure function, no closures over JS state) so the
 * gesture handlers can reuse it without re-creating the closure each render.
 */
function clampTranslation(
    tx: number,
    ty: number,
    s: number,
    baseW: number,
    baseH: number,
): { tx: number; ty: number } {
    'worklet';
    const scaledW = baseW * s;
    const scaledH = baseH * s;
    const maxX = Math.max(0, (scaledW - VIEWPORT_SIZE) / 2);
    const maxY = Math.max(0, (scaledH - VIEWPORT_SIZE) / 2);
    return {
        tx: Math.min(Math.max(tx, -maxX), maxX),
        ty: Math.min(Math.max(ty, -maxY), maxY),
    };
}

interface ImageNaturalSize {
    width: number;
    height: number;
}

/**
 * Lazy-loaded reference to the expo-image-manipulator module. The module is an
 * optional peer dep, so we resolve it on demand and surface a clean error
 * upstream if the consuming app has not installed it.
 */
interface ImageManipulatorModule {
    manipulateAsync: (
        uri: string,
        actions: Array<{
            crop?: { originX: number; originY: number; width: number; height: number };
            resize?: { width?: number; height?: number };
        }>,
        saveOptions?: { format?: 'jpeg' | 'png' | 'webp'; compress?: number },
    ) => Promise<{ uri: string; width: number; height: number }>;
    SaveFormat: { JPEG: 'jpeg'; PNG: 'png'; WEBP: 'webp' };
}

async function loadImageManipulator(): Promise<ImageManipulatorModule> {
    try {
        const mod = (await import('expo-image-manipulator')) as unknown as ImageManipulatorModule;
        if (!mod || typeof mod.manipulateAsync !== 'function') {
            throw new Error('expo-image-manipulator did not export manipulateAsync');
        }
        return mod;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
            `expo-image-manipulator is required for avatar cropping but is not installed: ${message}`,
        );
    }
}

const AvatarCropScreen: React.FC<AvatarCropScreenProps> = ({
    goBack,
    onClose,
    imageUri,
    sourceWidth,
    sourceHeight,
    onConfirm,
    onCancel,
}) => {
    const theme = useTheme();
    const { t } = useI18n();

    // Natural size of the source image. May be known up front (passed in) or
    // measured lazily via Image.getSize once the image loads.
    const [naturalSize, setNaturalSize] = useState<ImageNaturalSize | null>(
        sourceWidth && sourceHeight ? { width: sourceWidth, height: sourceHeight } : null,
    );
    const [isProcessing, setIsProcessing] = useState(false);

    // Shared values for the active gesture transform.
    const scale = useSharedValue(MIN_SCALE);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);

    // Refs that mirror the latest committed shared values so the JS-side
    // confirm handler can read them without an extra `useSharedValue → react`
    // bridge. Updated by `runOnJS(commit*)` from the gesture worklets.
    const committedScale = useRef(MIN_SCALE);
    const committedTranslateX = useRef(0);
    const committedTranslateY = useRef(0);

    // Saved start values for relative gesture math.
    const savedScale = useSharedValue(MIN_SCALE);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    // The image is rendered at "cover" relative to the viewport. We compute
    // `baseScale` so 1.0x means the image exactly covers the square; everything
    // larger than that is user-zoom.
    const baseFit = useMemo((): { width: number; height: number } | null => {
        if (!naturalSize) return null;
        const ratio = naturalSize.width / naturalSize.height;
        // Cover: the smaller dimension matches the viewport.
        if (ratio >= 1) {
            // Landscape — height fills viewport
            return { width: VIEWPORT_SIZE * ratio, height: VIEWPORT_SIZE };
        }
        return { width: VIEWPORT_SIZE, height: VIEWPORT_SIZE / ratio };
    }, [naturalSize]);

    const handleImageMeasured = useCallback(
        (uri: string) => {
            Image.getSize(
                uri,
                (w, h) => setNaturalSize({ width: w, height: h }),
                () => {
                    toast.error(
                        t('editProfile.toasts.cropMeasureFailed') || 'Could not measure the image',
                    );
                },
            );
        },
        [t],
    );

    // Trigger measurement once if we don't already know the natural size.
    if (!naturalSize && imageUri) {
        // Safe: Image.getSize is idempotent and we guard with naturalSize state.
        handleImageMeasured(imageUri);
    }

    const commitTransform = useCallback((s: number, tx: number, ty: number) => {
        committedScale.current = s;
        committedTranslateX.current = tx;
        committedTranslateY.current = ty;
    }, []);

    const panGesture = useMemo(
        () =>
            Gesture.Pan()
                .onStart(() => {
                    'worklet';
                    savedTranslateX.value = translateX.value;
                    savedTranslateY.value = translateY.value;
                })
                .onUpdate((event) => {
                    'worklet';
                    if (!baseFit) return;
                    const next = clampTranslation(
                        savedTranslateX.value + event.translationX,
                        savedTranslateY.value + event.translationY,
                        scale.value,
                        baseFit.width,
                        baseFit.height,
                    );
                    translateX.value = next.tx;
                    translateY.value = next.ty;
                })
                .onEnd(() => {
                    'worklet';
                    runOnJS(commitTransform)(scale.value, translateX.value, translateY.value);
                }),
        [baseFit, commitTransform, savedTranslateX, savedTranslateY, scale, translateX, translateY],
    );

    const pinchGesture = useMemo(
        () =>
            Gesture.Pinch()
                .onStart(() => {
                    'worklet';
                    savedScale.value = scale.value;
                })
                .onUpdate((event) => {
                    'worklet';
                    if (!baseFit) return;
                    const nextScale = Math.min(
                        MAX_SCALE,
                        Math.max(MIN_SCALE, savedScale.value * event.scale),
                    );
                    scale.value = nextScale;
                    // Re-clamp translation since the bounds depend on scale.
                    const clamped = clampTranslation(
                        translateX.value,
                        translateY.value,
                        nextScale,
                        baseFit.width,
                        baseFit.height,
                    );
                    translateX.value = clamped.tx;
                    translateY.value = clamped.ty;
                })
                .onEnd(() => {
                    'worklet';
                    runOnJS(commitTransform)(scale.value, translateX.value, translateY.value);
                }),
        [baseFit, commitTransform, savedScale, scale, translateX, translateY],
    );

    const composedGesture = useMemo(
        () => Gesture.Simultaneous(panGesture, pinchGesture),
        [panGesture, pinchGesture],
    );

    const imageAnimatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    const resetTransform = useCallback(() => {
        scale.value = withTiming(MIN_SCALE, { duration: 180 });
        translateX.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(0, { duration: 180 });
        commitTransform(MIN_SCALE, 0, 0);
    }, [commitTransform, scale, translateX, translateY]);

    /**
     * Convert the on-screen transform into pixel-space crop coordinates
     * relative to the source image, then invoke expo-image-manipulator to
     * crop + resize to 512x512 JPEG.
     */
    const handleConfirm = useCallback(async () => {
        if (!imageUri || !baseFit || !naturalSize) {
            toast.error(
                t('editProfile.toasts.cropNotReady') || 'Image not ready yet',
            );
            return;
        }

        setIsProcessing(true);
        try {
            const { manipulateAsync, SaveFormat } = await loadImageManipulator();

            const s = committedScale.current;
            const tx = committedTranslateX.current;
            const ty = committedTranslateY.current;

            // Visible viewport in *displayed image* pixel space (with scale applied):
            // The viewport is centered on the image origin, then offset by (-tx, -ty).
            const scaledImageWidth = baseFit.width * s;
            const scaledImageHeight = baseFit.height * s;

            // Top-left of viewport in displayed-pixel space:
            const viewportLeft = (scaledImageWidth - VIEWPORT_SIZE) / 2 - tx;
            const viewportTop = (scaledImageHeight - VIEWPORT_SIZE) / 2 - ty;

            // Convert to source-image pixel space:
            const sourcePerDisplay = naturalSize.width / scaledImageWidth;
            const cropX = Math.max(0, viewportLeft * sourcePerDisplay);
            const cropY = Math.max(0, viewportTop * sourcePerDisplay);
            const cropSize = Math.min(
                naturalSize.width - cropX,
                naturalSize.height - cropY,
                VIEWPORT_SIZE * sourcePerDisplay,
            );

            if (!Number.isFinite(cropSize) || cropSize <= 0) {
                throw new Error('Computed crop region is invalid');
            }

            const result = await manipulateAsync(
                imageUri,
                [
                    {
                        crop: {
                            originX: cropX,
                            originY: cropY,
                            width: cropSize,
                            height: cropSize,
                        },
                    },
                    { resize: { width: OUTPUT_SIZE, height: OUTPUT_SIZE } },
                ],
                { format: SaveFormat.JPEG, compress: 0.85 },
            );

            await onConfirm?.({
                uri: result.uri,
                width: result.width,
                height: result.height,
                mime: 'image/jpeg',
            });

            // Close the sheet on success. The caller is responsible for any
            // success toast (uploads typically toast their own outcome).
            onClose?.();
        } catch (err) {
            const message = err instanceof Error ? err.message : undefined;
            toast.error(
                message || t('editProfile.toasts.cropFailed') || 'Failed to crop image',
            );
        } finally {
            setIsProcessing(false);
        }
    }, [baseFit, imageUri, naturalSize, onClose, onConfirm, t]);

    const handleCancel = useCallback(() => {
        onCancel?.();
        goBack?.();
    }, [goBack, onCancel]);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    flex: 1,
                    backgroundColor: theme.colors.background,
                },
                stage: {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 24,
                },
                viewport: {
                    width: VIEWPORT_SIZE,
                    height: VIEWPORT_SIZE,
                    overflow: 'hidden',
                    borderRadius: VIEWPORT_SIZE / 2,
                    backgroundColor: theme.colors.backgroundSecondary,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                image: {
                    width: baseFit?.width ?? VIEWPORT_SIZE,
                    height: baseFit?.height ?? VIEWPORT_SIZE,
                },
                helper: {
                    marginTop: 16,
                    fontFamily: fontFamilies.inter,
                    fontSize: 13,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    maxWidth: 320,
                },
                actions: {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingBottom: 16,
                    gap: 12,
                },
                button: {
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                buttonSecondary: {
                    backgroundColor: theme.colors.backgroundSecondary,
                },
                buttonPrimary: {
                    backgroundColor: theme.colors.primary,
                },
                buttonPrimaryDisabled: {
                    opacity: 0.6,
                },
                buttonLabelSecondary: {
                    fontFamily: fontFamilies.interSemiBold,
                    fontSize: 15,
                    color: theme.colors.text,
                },
                buttonLabelPrimary: {
                    fontFamily: fontFamilies.interSemiBold,
                    fontSize: 15,
                    color: '#fff',
                },
                resetButton: {
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 16,
                    backgroundColor: theme.colors.backgroundSecondary,
                },
                resetLabel: {
                    fontFamily: fontFamilies.interMedium,
                    fontSize: 12,
                    color: theme.colors.text,
                },
                emptyState: {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                },
                emptyLabel: {
                    fontFamily: fontFamilies.inter,
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                },
            }),
        [baseFit, theme],
    );

    if (!imageUri) {
        return (
            <View style={styles.container}>
                <Header
                    title={t('editProfile.crop.title') || 'Crop avatar'}
                    onBack={handleCancel}
                    onClose={onClose}
                />
                <View style={styles.emptyState}>
                    <Text style={styles.emptyLabel}>
                        {t('editProfile.crop.noImage') || 'No image to crop'}
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Header
                title={t('editProfile.crop.title') || 'Crop avatar'}
                subtitle={t('editProfile.crop.subtitle') || 'Pinch to zoom, drag to position'}
                onBack={handleCancel}
                onClose={onClose}
            />
            <View style={styles.stage}>
                <View>
                    <GestureDetector gesture={composedGesture}>
                        <View style={styles.viewport}>
                            {baseFit ? (
                                <Animated.Image
                                    source={{ uri: imageUri }}
                                    style={[styles.image, imageAnimatedStyle]}
                                    resizeMode="cover"
                                />
                            ) : (
                                <ActivityIndicator color={theme.colors.primary} />
                            )}
                        </View>
                    </GestureDetector>
                    <TouchableOpacity
                        accessibilityLabel={t('editProfile.crop.reset') || 'Reset'}
                        style={styles.resetButton}
                        onPress={resetTransform}
                    >
                        <Text style={styles.resetLabel}>
                            {t('editProfile.crop.reset') || 'Reset'}
                        </Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.helper}>
                    {t('editProfile.crop.helper') ||
                        'The visible square will become your new avatar.'}
                </Text>
            </View>
            <View style={styles.actions}>
                <TouchableOpacity
                    accessibilityLabel={t('common.cancel') || 'Cancel'}
                    accessibilityRole="button"
                    style={[styles.button, styles.buttonSecondary]}
                    onPress={handleCancel}
                    disabled={isProcessing}
                >
                    <Text style={styles.buttonLabelSecondary}>
                        {t('common.cancel') || 'Cancel'}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityLabel={t('editProfile.crop.confirm') || 'Use photo'}
                    accessibilityRole="button"
                    style={[
                        styles.button,
                        styles.buttonPrimary,
                        isProcessing && styles.buttonPrimaryDisabled,
                    ]}
                    onPress={handleConfirm}
                    disabled={isProcessing || !baseFit}
                >
                    {isProcessing ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonLabelPrimary}>
                            {t('editProfile.crop.confirm') || 'Use photo'}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
};

export default AvatarCropScreen;
