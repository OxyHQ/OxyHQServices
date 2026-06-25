/**
 * AvatarCropScreen
 *
 * Flagship-grade circular crop editor presented after the user picks an image
 * but before the avatar is uploaded. Inspired by iOS Photos, Google Photos and
 * Instagram crop tools.
 *
 * Architecture:
 *  - Full-bleed black canvas, independent of theme, so photos always read well.
 *  - Translucent top bar with Cancel / Title / Done (primary CTA).
 *  - Circular viewport with white ring, outer 50% black mask, and a 3x3
 *    rule-of-thirds grid that appears during gestures and fades after 800ms.
 *  - Floating zoom chip during pinch.
 *  - Pan + pinch via Gesture Handler, transform driven by Reanimated.
 *  - Reduced-motion aware entrance animation.
 *  - Haptics on milestones via dynamically imported expo-haptics (optional).
 *
 * `expo-image-manipulator` and `expo-haptics` are optional peer dependencies —
 * loaded with `await import(...)`. A missing manipulator surfaces a clear
 * error; missing haptics simply degrades silently.
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    TouchableOpacity,
    Image,
    Platform,
    AccessibilityInfo,
    Pressable,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@oxyhq/bloom/theme';
import { logger } from '@oxyhq/core';
import { useI18n } from '../hooks/useI18n';
import { toast } from '@oxyhq/bloom';
import type { BaseScreenProps } from '../types/navigation';

/** Component name used in `logger` context for filtered diagnostics. */
const LOG_COMPONENT = 'AvatarCropScreen';

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
/** Duration (ms) that the rule-of-thirds grid lingers after a gesture ends. */
const GRID_FADE_DELAY_MS = 800;
const GRID_FADE_DURATION_MS = 220;
/** Duration the zoom chip stays visible after a pinch ends. */
const ZOOM_CHIP_FADE_DELAY_MS = 600;
const ZOOM_CHIP_FADE_DURATION_MS = 200;
/** Backdrop color is fixed independent of theme so the photo always reads well. */
const CANVAS_BG = '#000000';
const RING_COLOR = '#ffffff';
const RING_WIDTH = 2;
const REMOTE_HTTP_URI_PATTERN = /^https?:\/\//i;

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

interface PreparedManipulatorImage {
    uri: string;
    cleanup?: () => void;
}

function isCanvasLoadFailure(err: unknown): boolean {
    return (
        Platform.OS === 'web' &&
        typeof HTMLCanvasElement !== 'undefined' &&
        err instanceof HTMLCanvasElement
    );
}

const SENSITIVE_URI_PATTERN =
    /\b(?:file|content|ph|assets-library):\/\/\S+|\/(?:data|var|private|storage|sdcard|tmp)\/\S+/gi;

function sanitizeImageErrorMessage(message: string): string {
    return message.replace(SENSITIVE_URI_PATTERN, '[redacted-uri]');
}

function normalizeCropError(err: unknown): Error {
    if (isCanvasLoadFailure(err)) {
        return new Error('Image could not be loaded for cropping');
    }
    if (err instanceof Error) {
        return new Error(sanitizeImageErrorMessage(err.message || 'Failed to crop image'));
    }
    if (typeof err === 'string' && err.trim()) {
        return new Error(sanitizeImageErrorMessage(err.trim()));
    }
    return new Error('Failed to crop image');
}

async function prepareImageForManipulator(uri: string): Promise<PreparedManipulatorImage> {
    if (Platform.OS !== 'web' || !REMOTE_HTTP_URI_PATTERN.test(uri)) {
        return { uri };
    }

    let response: Response;
    try {
        response = await fetch(uri);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Image could not be loaded for cropping: ${message}`);
    }

    if (!response.ok) {
        throw new Error(`Image could not be loaded for cropping (${response.status})`);
    }

    const blob = await response.blob();
    if (blob.size <= 0) {
        throw new Error('Image could not be loaded for cropping');
    }

    const contentType = response.headers.get('content-type') || blob.type;
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
        throw new Error('Selected file is not an image');
    }

    const objectUrl = URL.createObjectURL(blob);
    return {
        uri: objectUrl,
        cleanup: () => URL.revokeObjectURL(objectUrl),
    };
}

/**
 * Haptic feedback wrapper. `expo-haptics` is an optional dependency — when not
 * installed (or on web), all calls degrade silently. We resolve the module once
 * and cache the promise so subsequent calls don't repeat the dynamic import.
 */
type HapticImpact = 'light' | 'medium' | 'heavy';
type HapticNotification = 'success' | 'warning' | 'error';
interface HapticsModule {
    impactAsync: (style: unknown) => Promise<void>;
    notificationAsync: (type: unknown) => Promise<void>;
    selectionAsync: () => Promise<void>;
    ImpactFeedbackStyle: { Light: unknown; Medium: unknown; Heavy: unknown };
    NotificationFeedbackType: { Success: unknown; Warning: unknown; Error: unknown };
}

let hapticsModulePromise: Promise<HapticsModule | null> | null = null;
function getHaptics(): Promise<HapticsModule | null> {
    if (Platform.OS === 'web') return Promise.resolve(null);
    if (hapticsModulePromise) return hapticsModulePromise;
    hapticsModulePromise = (async () => {
        try {
            const mod = (await import('expo-haptics')) as unknown as HapticsModule;
            if (!mod || typeof mod.impactAsync !== 'function') return null;
            return mod;
        } catch {
            return null;
        }
    })();
    return hapticsModulePromise;
}

async function hapticImpact(style: HapticImpact): Promise<void> {
    const h = await getHaptics();
    if (!h) return;
    const styleEnum =
        style === 'heavy'
            ? h.ImpactFeedbackStyle.Heavy
            : style === 'medium'
                ? h.ImpactFeedbackStyle.Medium
                : h.ImpactFeedbackStyle.Light;
    try {
        await h.impactAsync(styleEnum);
    } catch {
        // Silent — haptics are non-critical UX polish.
    }
}

async function hapticNotification(type: HapticNotification): Promise<void> {
    const h = await getHaptics();
    if (!h) return;
    const typeEnum =
        type === 'error'
            ? h.NotificationFeedbackType.Error
            : type === 'warning'
                ? h.NotificationFeedbackType.Warning
                : h.NotificationFeedbackType.Success;
    try {
        await h.notificationAsync(typeEnum);
    } catch {
        // Silent.
    }
}

async function hapticSelection(): Promise<void> {
    const h = await getHaptics();
    if (!h) return;
    try {
        await h.selectionAsync();
    } catch {
        // Silent.
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
    const insets = useSafeAreaInsets();

    // Natural size of the source image. May be known up front (passed in) or
    // measured lazily via Image.getSize once the image loads.
    const [naturalSize, setNaturalSize] = useState<ImageNaturalSize | null>(
        sourceWidth && sourceHeight ? { width: sourceWidth, height: sourceHeight } : null,
    );
    const [isProcessing, setIsProcessing] = useState(false);
    const [zoomLabel, setZoomLabel] = useState('1.0');
    /** True when scale != MIN_SCALE OR translate != 0 — used to reveal the reset link. */
    const [isModified, setIsModified] = useState(false);
    const [reduceMotion, setReduceMotion] = useState(false);

    // Shared values for the active gesture transform.
    const scale = useSharedValue(MIN_SCALE);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);

    // Entrance scale of the crop circle (pulse-in on mount).
    const entrance = useSharedValue(reduceMotion ? 1 : 0.95);
    /** 0..1 opacity for the rule-of-thirds grid and zoom chip. */
    const gridOpacity = useSharedValue(0);
    const zoomChipOpacity = useSharedValue(0);

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

    // Track whether we've already announced a min/max bound during the current
    // pinch so selection haptics don't fire on every frame.
    const hitMinRef = useRef(false);
    const hitMaxRef = useRef(false);

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

    // Track in-flight measurement to avoid duplicate Image.getSize calls when
    // the component re-renders before the previous getSize callback fires.
    const measuringUriRef = useRef<string | null>(null);
    /** Failure state for measurement, surfaced to the user via the empty UI. */
    const [measureError, setMeasureError] = useState<string | null>(null);

    const handleImageMeasured = useCallback(
        (uri: string) => {
            if (measuringUriRef.current === uri) return;
            measuringUriRef.current = uri;
            // `logger.debug` is dev-gated upstream (no-op in production).
            // We deliberately don't log the full file URI in any production
            // path — only in debug builds — to avoid leaking on-device file
            // paths into logcat / Sentry breadcrumbs.
            logger.debug('Measuring image', { component: LOG_COMPONENT });
            Image.getSize(
                uri,
                (w, h) => {
                    logger.debug('Image measured', { component: LOG_COMPONENT }, { width: w, height: h });
                    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
                        const message = t('editProfile.toasts.cropMeasureFailed') ||
                            'Could not measure the image';
                        setMeasureError(message);
                        toast.error(message);
                        measuringUriRef.current = null;
                        return;
                    }
                    setMeasureError(null);
                    setNaturalSize({ width: w, height: h });
                },
                () => {
                    logger.error(
                        'Image.getSize failed',
                        new Error('Image measurement failed'),
                        { component: LOG_COMPONENT },
                    );
                    const message = t('editProfile.toasts.cropMeasureFailed') ||
                        'Could not measure the image';
                    setMeasureError(message);
                    toast.error(message);
                    measuringUriRef.current = null;
                },
            );
        },
        [t],
    );

    // Kick off measurement once per imageUri. Using useEffect (not a render-body
    // side effect) so the call is scheduled exactly when the URI changes,
    // rather than being re-fired on every parent re-render.
    useEffect(() => {
        if (!imageUri) return;
        if (sourceWidth && sourceHeight) return;
        if (naturalSize) return;
        handleImageMeasured(imageUri);
    }, [handleImageMeasured, imageUri, naturalSize, sourceHeight, sourceWidth]);

    // Dev-only one-time mount breadcrumb. `logger.debug` is dev-gated so
    // this is a no-op in production releases; we additionally avoid logging
    // the full `imageUri` to prevent leaking on-device file paths into any
    // breadcrumb sink that picks up debug output.
    useEffect(() => {
        logger.debug(
            'mount',
            { component: LOG_COMPONENT },
            {
                hasImageUri: !!imageUri,
                hasSourceDimensions: !!(sourceWidth && sourceHeight),
            },
        );
    }, [imageUri, sourceHeight, sourceWidth]);

    // Detect reduce-motion preference once on mount + subscribe to changes.
    useEffect(() => {
        let cancelled = false;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((enabled) => {
                if (cancelled) return;
                setReduceMotion(enabled);
                if (enabled) {
                    entrance.value = 1;
                }
            })
            .catch(() => {
                // Best-effort — fall back to motion enabled.
            });
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
            setReduceMotion(enabled);
            if (enabled) entrance.value = 1;
        });
        return () => {
            cancelled = true;
            sub.remove();
        };
    }, [entrance]);

    // Play the entrance pulse exactly once when motion is allowed.
    useEffect(() => {
        if (reduceMotion) return;
        entrance.value = withSpring(1, {
            damping: 14,
            stiffness: 180,
            mass: 0.9,
        });
    }, [entrance, reduceMotion]);

    const commitTransform = useCallback((s: number, tx: number, ty: number) => {
        committedScale.current = s;
        committedTranslateX.current = tx;
        committedTranslateY.current = ty;
        const modified =
            Math.abs(s - MIN_SCALE) > 0.001 || Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5;
        setIsModified(modified);
        setZoomLabel(s.toFixed(1));
    }, []);

    /** Show the rule-of-thirds grid; called from gesture worklets via runOnJS-free path. */
    const showGrid = useCallback(() => {
        gridOpacity.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) });
    }, [gridOpacity]);

    const hideGrid = useCallback(() => {
        gridOpacity.value = withDelay(
            GRID_FADE_DELAY_MS,
            withTiming(0, { duration: GRID_FADE_DURATION_MS, easing: Easing.in(Easing.quad) }),
        );
    }, [gridOpacity]);

    const showZoomChip = useCallback(() => {
        zoomChipOpacity.value = withTiming(1, { duration: 100 });
    }, [zoomChipOpacity]);

    const hideZoomChip = useCallback(() => {
        zoomChipOpacity.value = withDelay(
            ZOOM_CHIP_FADE_DELAY_MS,
            withTiming(0, { duration: ZOOM_CHIP_FADE_DURATION_MS }),
        );
    }, [zoomChipOpacity]);

    /** Dev-only ping fired once per gesture start so we can confirm in logs. */
    const logGestureStart = useCallback((kind: 'pan' | 'pinch') => {
        logger.debug(`gesture start: ${kind}`, { component: LOG_COMPONENT });
    }, []);

    const panGesture = useMemo(
        () =>
            Gesture.Pan()
                .minDistance(2)
                .onStart(() => {
                    'worklet';
                    savedTranslateX.value = translateX.value;
                    savedTranslateY.value = translateY.value;
                    runOnJS(showGrid)();
                    runOnJS(logGestureStart)('pan');
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
                    runOnJS(hideGrid)();
                }),
        [
            baseFit,
            commitTransform,
            hideGrid,
            logGestureStart,
            savedTranslateX,
            savedTranslateY,
            scale,
            showGrid,
            translateX,
            translateY,
        ],
    );

    /** Imperative helpers invoked from worklets via runOnJS. Stable refs. */
    const resetPinchBounds = useCallback((): void => {
        hitMinRef.current = false;
        hitMaxRef.current = false;
    }, []);

    const updateZoomLabel = useCallback((s: number): void => {
        setZoomLabel(s.toFixed(1));
    }, []);

    const notifyMinBoundHit = useCallback((): void => {
        if (hitMinRef.current) return;
        hitMinRef.current = true;
        void hapticSelection();
    }, []);

    const notifyMaxBoundHit = useCallback((): void => {
        if (hitMaxRef.current) return;
        hitMaxRef.current = true;
        void hapticSelection();
    }, []);

    const pinchGesture = useMemo(
        () =>
            Gesture.Pinch()
                .onStart(() => {
                    'worklet';
                    savedScale.value = scale.value;
                    runOnJS(showGrid)();
                    runOnJS(showZoomChip)();
                    runOnJS(resetPinchBounds)();
                    runOnJS(logGestureStart)('pinch');
                })
                .onUpdate((event) => {
                    'worklet';
                    if (!baseFit) return;
                    const raw = savedScale.value * event.scale;
                    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
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
                    runOnJS(updateZoomLabel)(nextScale);
                    // Selection haptic on first frame at min/max.
                    if (nextScale <= MIN_SCALE + 0.001 && raw < MIN_SCALE) {
                        runOnJS(notifyMinBoundHit)();
                    } else if (nextScale >= MAX_SCALE - 0.001 && raw > MAX_SCALE) {
                        runOnJS(notifyMaxBoundHit)();
                    }
                })
                .onEnd(() => {
                    'worklet';
                    runOnJS(commitTransform)(scale.value, translateX.value, translateY.value);
                    runOnJS(hideGrid)();
                    runOnJS(hideZoomChip)();
                }),
        [
            baseFit,
            commitTransform,
            hideGrid,
            hideZoomChip,
            logGestureStart,
            notifyMaxBoundHit,
            notifyMinBoundHit,
            resetPinchBounds,
            savedScale,
            scale,
            showGrid,
            showZoomChip,
            translateX,
            translateY,
            updateZoomLabel,
        ],
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

    const cropFrameAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: entrance.value }],
    }));

    const gridAnimatedStyle = useAnimatedStyle(() => ({
        opacity: gridOpacity.value,
    }));

    const zoomChipAnimatedStyle = useAnimatedStyle(() => ({
        opacity: zoomChipOpacity.value,
    }));

    const resetTransform = useCallback(() => {
        const duration = reduceMotion ? 0 : 220;
        scale.value = withTiming(MIN_SCALE, { duration });
        translateX.value = withTiming(0, { duration });
        translateY.value = withTiming(0, { duration });
        commitTransform(MIN_SCALE, 0, 0);
        void hapticImpact('light');
        AccessibilityInfo.announceForAccessibility(
            t('editProfile.crop.a11yResetAnnouncement') || 'Crop reset',
        );
    }, [commitTransform, reduceMotion, scale, t, translateX, translateY]);

    /**
     * Convert the on-screen transform into pixel-space crop coordinates
     * relative to the source image, then invoke expo-image-manipulator to
     * crop + resize to 512x512 JPEG.
     */
    const handleConfirm = useCallback(async () => {
        // Dev-only breadcrumb. Avoid logging `imageUri` so on-device file
        // paths don't leak into breadcrumb sinks that surface debug output.
        logger.debug(
            'handleConfirm start',
            { component: LOG_COMPONENT },
            {
                hasBaseFit: !!baseFit,
                hasNaturalSize: !!naturalSize,
                committedScale: committedScale.current,
                committedTranslateX: committedTranslateX.current,
                committedTranslateY: committedTranslateY.current,
            },
        );
        if (!imageUri || !baseFit || !naturalSize) {
            toast.error(
                t('editProfile.toasts.cropNotReady') || 'Image not ready yet',
            );
            return;
        }

        setIsProcessing(true);
        let preparedImageCleanup: (() => void) | undefined;
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

            // Dev-only crop coordinates. We log the derived crop region but
            // never the input URI — paths are PII-adjacent on some platforms.
            logger.debug(
                'manipulateAsync input',
                { component: LOG_COMPONENT },
                {
                    cropX,
                    cropY,
                    cropSize,
                    outputSize: OUTPUT_SIZE,
                },
            );

            const preparedImage = await prepareImageForManipulator(imageUri);
            preparedImageCleanup = preparedImage.cleanup;
            const result = await manipulateAsync(
                preparedImage.uri,
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

            // Log only the result's dimensions, never the on-disk URI.
            logger.debug(
                'manipulateAsync result',
                { component: LOG_COMPONENT },
                { width: result.width, height: result.height },
            );

            void hapticNotification('success');

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
            const normalizedError = normalizeCropError(err);
            logger.error('handleConfirm failed', normalizedError, { component: LOG_COMPONENT });
            void hapticNotification('error');
            toast.error(
                normalizedError.message || t('editProfile.toasts.cropFailed') || 'Failed to crop image',
            );
        } finally {
            preparedImageCleanup?.();
            setIsProcessing(false);
        }
    }, [baseFit, imageUri, naturalSize, onClose, onConfirm, t]);

    const handleCancel = useCallback(() => {
        onCancel?.();
        goBack?.();
    }, [goBack, onCancel]);

    const topInset = Platform.OS === 'ios' ? Math.max(insets.top, 12) : Math.max(insets.top, 16);
    const bottomInset = Math.max(insets.bottom, 16);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    flex: 1,
                    backgroundColor: CANVAS_BG,
                },
                topBar: {
                    paddingTop: topInset,
                    paddingHorizontal: 12,
                    paddingBottom: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    zIndex: 10,
                },
                topBarTitleWrap: {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                },
                topBarTitle: {
                    color: '#ffffff',
                    fontSize: 17,
                    letterSpacing: -0.2,
                    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
                },
                cancelBtn: {
                    minWidth: 64,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 18,
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                },
                cancelLabel: {
                    color: '#ffffff',
                    fontSize: 15,
                    opacity: 0.85,
                },
                doneBtn: {
                    minWidth: 76,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.colors.primary,
                },
                doneBtnDisabled: {
                    opacity: 0.5,
                },
                doneLabel: {
                    color: '#ffffff',
                    fontSize: 15,
                    letterSpacing: -0.1,
                    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
                },
                doneLabelLoading: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                },
                stage: {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 16,
                },
                cropFrame: {
                    width: VIEWPORT_SIZE,
                    height: VIEWPORT_SIZE,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                viewport: {
                    width: VIEWPORT_SIZE,
                    height: VIEWPORT_SIZE,
                    overflow: 'hidden',
                    borderRadius: VIEWPORT_SIZE / 2,
                    backgroundColor: '#1a1a1a',
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                image: {
                    width: baseFit?.width ?? VIEWPORT_SIZE,
                    height: baseFit?.height ?? VIEWPORT_SIZE,
                },
                // Outer mask: large square that overlays the canvas, with a
                // round transparent cutout in the middle. We achieve this with
                // four edge boxes around the circle (top/bottom/left/right) so
                // there's no need for SVG. Each box is 50% black.
                ringOverlay: {
                    position: 'absolute',
                    width: VIEWPORT_SIZE,
                    height: VIEWPORT_SIZE,
                    borderRadius: VIEWPORT_SIZE / 2,
                    borderWidth: RING_WIDTH,
                    borderColor: RING_COLOR,
                    // Subtle inner shadow approximated with a thin secondary border.
                    ...Platform.select({
                        web: {
                            boxShadow: 'inset 0 0 14px rgba(0,0,0,0.45)',
                        },
                        default: {},
                    }),
                },
                gridOverlay: {
                    position: 'absolute',
                    width: VIEWPORT_SIZE,
                    height: VIEWPORT_SIZE,
                    borderRadius: VIEWPORT_SIZE / 2,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                },
                gridLineH: {
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: 'rgba(255,255,255,0.45)',
                },
                gridLineV: {
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    width: StyleSheet.hairlineWidth,
                    backgroundColor: 'rgba(255,255,255,0.45)',
                },
                zoomChip: {
                    position: 'absolute',
                    top: -44,
                    alignSelf: 'center',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    minWidth: 56,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                zoomChipText: {
                    color: '#ffffff',
                    fontFamily: Platform.select({
                        ios: 'Menlo',
                        android: 'monospace',
                        default: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }),
                    fontSize: 12,
                    letterSpacing: 0.2,
                },
                helperBlock: {
                    paddingHorizontal: 24,
                    paddingTop: 24,
                    paddingBottom: bottomInset,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 10,
                },
                helper: {
                    fontSize: 13,
                    lineHeight: 18,
                    color: 'rgba(255,255,255,0.6)',
                    textAlign: 'center',
                    maxWidth: 320,
                },
                resetLink: {
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                },
                resetLinkText: {
                    fontSize: 13,
                    color: '#ffffff',
                    opacity: 0.85,
                    textDecorationLine: 'underline',
                },
                emptyState: {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                },
                emptyLabel: {
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.7)',
                    textAlign: 'center',
                },
            }),
        [baseFit, bottomInset, theme, topInset],
    );

    // Reset link reveal — only show when the image is not at the default
    // transform. Use derived display state to avoid mounting/unmounting jank.
    const resetLinkOpacity = isModified ? 1 : 0;

    // No image supplied OR measurement failed — render a minimal empty state.
    if (!imageUri || measureError) {
        const emptyMessage = !imageUri
            ? (t('editProfile.crop.noImage') || 'No image to crop')
            : measureError;
        return (
            <View style={styles.container}>
                <View style={styles.topBar}>
                    <TouchableOpacity
                        accessibilityLabel={t('editProfile.crop.cancel') || 'Cancel'}
                        accessibilityRole="button"
                        style={styles.cancelBtn}
                        onPress={handleCancel}
                        activeOpacity={0.6}
                    >
                        <Text style={styles.cancelLabel}>
                            {t('editProfile.crop.cancel') || 'Cancel'}
                        </Text>
                    </TouchableOpacity>
                    <View style={styles.topBarTitleWrap}>
                        <Text style={styles.topBarTitle}>
                            {t('editProfile.crop.title') || 'Crop avatar'}
                        </Text>
                    </View>
                    <View style={styles.cancelBtn} />
                </View>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyLabel}>{emptyMessage}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.topBar}>
                <TouchableOpacity
                    accessibilityLabel={t('editProfile.crop.cancel') || 'Cancel'}
                    accessibilityRole="button"
                    style={styles.cancelBtn}
                    onPress={handleCancel}
                    disabled={isProcessing}
                    activeOpacity={0.6}
                >
                    <Text style={styles.cancelLabel}>
                        {t('editProfile.crop.cancel') || 'Cancel'}
                    </Text>
                </TouchableOpacity>
                <View style={styles.topBarTitleWrap}>
                    <Text style={styles.topBarTitle} numberOfLines={1}>
                        {t('editProfile.crop.title') || 'Crop avatar'}
                    </Text>
                </View>
                <TouchableOpacity
                    accessibilityLabel={t('editProfile.crop.confirm') || 'Use photo'}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isProcessing || !baseFit, busy: isProcessing }}
                    style={[
                        styles.doneBtn,
                        (isProcessing || !baseFit) && styles.doneBtnDisabled,
                    ]}
                    onPress={handleConfirm}
                    disabled={isProcessing || !baseFit}
                    activeOpacity={0.85}
                >
                    {isProcessing ? (
                        <View style={styles.doneLabelLoading}>
                            <ActivityIndicator size="small" color="#ffffff" />
                            <Text style={styles.doneLabel}>
                                {t('editProfile.crop.saving') || 'Saving…'}
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.doneLabel}>
                            {t('editProfile.crop.confirm') || 'Use photo'}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>

            <View style={styles.stage}>
                <Animated.View
                    style={[styles.cropFrame, cropFrameAnimatedStyle]}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={
                        t('editProfile.crop.a11yImage') ||
                        'Crop preview. Pinch to zoom and drag to reposition the image.'
                    }
                >
                    <GestureDetector gesture={composedGesture}>
                        <View style={styles.viewport}>
                            {baseFit ? (
                                <Animated.Image
                                    source={{ uri: imageUri }}
                                    style={[styles.image, imageAnimatedStyle]}
                                    resizeMode="cover"
                                />
                            ) : (
                                <ActivityIndicator color="#ffffff" />
                            )}
                        </View>
                    </GestureDetector>

                    {/* White ring + inner shadow around the circle. */}
                    <View pointerEvents="none" style={styles.ringOverlay} />

                    {/* Rule-of-thirds grid overlay (fades in during gesture). */}
                    <Animated.View
                        pointerEvents="none"
                        style={[styles.gridOverlay, gridAnimatedStyle]}
                    >
                        <View style={[styles.gridLineH, { top: VIEWPORT_SIZE / 3 }]} />
                        <View style={[styles.gridLineH, { top: (VIEWPORT_SIZE * 2) / 3 }]} />
                        <View style={[styles.gridLineV, { left: VIEWPORT_SIZE / 3 }]} />
                        <View style={[styles.gridLineV, { left: (VIEWPORT_SIZE * 2) / 3 }]} />
                    </Animated.View>

                    {/* Floating zoom chip during pinch. */}
                    <Animated.View
                        pointerEvents="none"
                        style={[styles.zoomChip, zoomChipAnimatedStyle]}
                    >
                        <Text style={styles.zoomChipText}>
                            {t('editProfile.crop.zoom', { value: zoomLabel }) || `${zoomLabel}×`}
                        </Text>
                    </Animated.View>
                </Animated.View>
            </View>

            <View style={styles.helperBlock}>
                <Text style={styles.helper}>
                    {t('editProfile.crop.helper') ||
                        'The cropped circle is what will appear on your profile. Pinch to zoom, drag to position.'}
                </Text>
                <Pressable
                    accessibilityLabel={t('editProfile.crop.a11yReset') || 'Reset crop to default position'}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !isModified || isProcessing }}
                    onPress={resetTransform}
                    disabled={!isModified || isProcessing}
                    style={[styles.resetLink, { opacity: isProcessing ? 0.3 : resetLinkOpacity }]}
                >
                    <Text style={styles.resetLinkText}>
                        {t('editProfile.crop.resetToCenter') || 'Reset to center'}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
};

export default AvatarCropScreen;
