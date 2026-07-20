import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    FlatList,
    Platform,
    Animated,
    useWindowDimensions,
    type LayoutChangeEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { FileMetadata } from '@oxyhq/core';
import { computePhotoGridLayout } from './photoGridLayout';

/**
 * Haptic feedback wrapper. `expo-haptics` is an optional dependency — when not
 * installed (or on web), all calls degrade silently. We resolve the module
 * once and cache the promise so subsequent calls don't repeat the dynamic
 * import. Matches the pattern used by AvatarCropScreen.
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
const getHaptics = (): Promise<HapticsModule | null> => {
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
};

const hapticImpact = async (style: HapticImpact): Promise<void> => {
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
};

const hapticSelection = async (): Promise<void> => {
    const h = await getHaptics();
    if (!h) return;
    try {
        await h.selectionAsync();
    } catch {
        // Silent.
    }
};

const hapticNotification = async (type: HapticNotification): Promise<void> => {
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
};

/**
 * The bottom sheet renders below the status bar already (its `maxHeight` is
 * capped by `SCREEN_HEIGHT - insets.top`), so the picker MUST NOT add an extra
 * safe-area inset to the header. Header zone from the sheet top:
 *   • 28dp drag-handle hit area floats at the very top of the sheet
 *   • 56dp app bar sits immediately below the handle
 * Grid content is pushed down by the full header zone + 4dp of breathing room
 * so the first row clears the translucent header. These are fixed layout
 * constants — the equivalent `pt-[28px]` / `min-h-[84px]` / `pt-[88px]` utility
 * classes in the JSX MUST stay in sync with them.
 */
const HANDLE_ZONE = 28;
const APP_BAR_HEIGHT = 56;
const HEADER_HEIGHT = HANDLE_ZONE + APP_BAR_HEIGHT; // 84
const GRID_CONTENT_PADDING_TOP = HEADER_HEIGHT + 4; // 88

/**
 * Props for the dedicated photo picker view. Used by FileManagementScreen
 * only when `selectMode + image-only` is active. All callbacks are wired by
 * the parent — this component is purely presentational.
 */
export interface PhotoPickerViewProps {
    photos: FileMetadata[];
    selectedIds: Set<string>;
    multiSelect: boolean;
    maxSelection?: number;
    allowUpload: boolean;
    refreshing: boolean;
    uploading: boolean;
    isPickingDocument: boolean;
    uploadProgress: { current: number; total: number } | null;
    hasMore: boolean;
    loadingMore: boolean;
    reduceMotion: boolean;
    getThumbUrl: (file: FileMetadata) => string | undefined;
    primaryColor: string;
    isOwner: boolean;
    onTogglePhoto: (photo: FileMetadata) => void;
    onPreviewPhoto: (photo: FileMetadata) => void;
    onUpload: () => void;
    onRefresh: () => void;
    onLoadMore: () => void;
    onCancel: () => void;
    onConfirm: () => void;
    t: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * Photo-cell animation tuning. The animated cell uses RN's own `Animated`
 * (NOT Reanimated): its entrance is a staggered opacity fade — replacing the
 * Reanimated `entering={FadeIn}` LAYOUT animation, which cannot load on the
 * RN-Web build (no `react-native-worklets` babel plugin) and only warns +
 * no-ops there. RN `Animated` runs cross-platform: native-driven on device,
 * JS-driven on web (`useNativeDriver: false`), so the fade actually plays on
 * web instead of being skipped.
 */
const STAGGER_PER_CELL_MS = 15;
const MAX_TOTAL_STAGGER_MS = 800;
const ENTRANCE_DURATION_MS = 200;
/** Selection-ring pulse: a quick scale bump that springs back to rest. */
const RING_PULSE_PEAK = 1.05;
const RING_PULSE_UP_MS = 110;
const RING_SPRING_FRICTION = 9;
const RING_SPRING_TENSION = 120;
/**
 * Inline mirror of the `rounded-radius-8 border-[3px]` classes the static ring
 * carries. The animated ring MUST use inline `style` (its animated transform
 * has to be inline, and NativeWind `className` interop is not guaranteed on an
 * `Animated.View` under the RN-Web build), so these keep it pixel-identical to
 * the static ring.
 */
const CELL_CORNER_RADIUS = 8; // `rounded-radius-8`
const SELECTION_RING_WIDTH = 3; // `border-[3px]`

/**
 * A single photo cell. Memoized so re-renders during selection only touch
 * affected cells — selection of one photo must not redraw the whole grid.
 *
 * Apple Photos pattern: when any cell is selected, *non-selected* siblings
 * fade to 0.6 opacity to focus attention on the active selection.
 */
/**
 * Shared cell chrome (image, dim, badge). Ring border is injected by the
 * static vs animated wrappers.
 */
function PhotoPickerCellContent(props: {
    photo: FileMetadata;
    dim: boolean;
    isSelected: boolean;
    selectionIndex: number;
    primaryColor: string;
    thumbUrl: string | undefined;
    ring: React.ReactNode;
}) {
    const {
        photo, dim, isSelected, selectionIndex, primaryColor, thumbUrl, ring,
    } = props;

    return (
        <>
            {/* Inline `flex: 1` is load-bearing on web and NOT interchangeable with
                the `flex-1` class: on RN-Web the NativeWind/react-native-css `flex-1`
                utility does not reliably resolve to `flex: 1` (the class is present in
                the DOM but inert — RN-Web's base View atomic styles out-rank it), so
                this content View collapses to 0 height and the image (`height: 100%` of
                a 0-height box) becomes invisible — every tile blank. Inline style always
                wins, so it is the sanctioned exception here. Native is unaffected. */}
            <View
                style={{ flex: 1 }}
                className={`flex-1 rounded-radius-8 overflow-hidden bg-[#111111]${dim ? ' opacity-60' : ''}`}
            >
                <ExpoImage
                    source={{ uri: thumbUrl }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    transition={120}
                    cachePolicy="memory-disk"
                    accessibilityLabel={photo.filename}
                />
            </View>
            {ring}
            {isSelected && (
                <View
                    pointerEvents="none"
                    className="absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1.5 rounded-full items-center justify-center"
                    style={{ backgroundColor: primaryColor }}
                >
                    <Text className="text-white text-[12px] font-bold leading-[14px]">
                        {selectionIndex > 0 ? String(selectionIndex) : ''}
                    </Text>
                </View>
            )}
        </>
    );
}

type PhotoPickerCellProps = {
    photo: FileMetadata;
    size: number;
    marginRight: number;
    marginBottom: number;
    isSelected: boolean;
    selectionIndex: number;
    dim: boolean;
    primaryColor: string;
    thumbUrl: string | undefined;
    enterIndex: number;
    reduceMotion: boolean;
    onPress: () => void;
    onLongPress: () => void;
    a11yLabel: string;
};

const PhotoPickerCellStatic = React.memo(function PhotoPickerCellStatic(props: PhotoPickerCellProps) {
    const {
        photo, size, marginRight, marginBottom, isSelected, selectionIndex,
        dim, primaryColor, thumbUrl, onPress, onLongPress, a11yLabel,
    } = props;

    const cellWrapperStyle = {
        width: size,
        height: size,
        marginRight,
        marginBottom,
    };

    const ring = isSelected ? (
        <View
            pointerEvents="none"
            className="absolute inset-0 rounded-radius-8 border-[3px]"
            style={{ borderColor: primaryColor }}
        />
    ) : null;

    return (
        <TouchableOpacity
            activeOpacity={0.85}
            onPress={onPress}
            onLongPress={onLongPress}
            className="relative"
            style={cellWrapperStyle}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
            accessibilityState={{ selected: isSelected }}
        >
            <PhotoPickerCellContent
                photo={photo}
                dim={dim}
                isSelected={isSelected}
                selectionIndex={selectionIndex}
                primaryColor={primaryColor}
                thumbUrl={thumbUrl}
                ring={ring}
            />
        </TouchableOpacity>
    );
});

const PhotoPickerCellAnimated = React.memo(function PhotoPickerCellAnimated(props: PhotoPickerCellProps) {
    const {
        photo, size, marginRight, marginBottom, isSelected, selectionIndex,
        dim, primaryColor, thumbUrl, enterIndex, onPress, onLongPress, a11yLabel,
    } = props;

    const delay = Math.min(enterIndex * STAGGER_PER_CELL_MS, MAX_TOTAL_STAGGER_MS);

    // Entrance: a per-cell opacity fade, staggered by the cell's grid index.
    // `useNativeDriver` is only available on native — on web the animation is
    // JS-driven, which still plays the fade (unlike Reanimated layout entering,
    // which no-ops on the plugin-less RN-Web build).
    const opacity = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const entrance = Animated.timing(opacity, {
            toValue: 1,
            duration: ENTRANCE_DURATION_MS,
            delay,
            useNativeDriver: Platform.OS !== 'web',
        });
        entrance.start();
        return () => entrance.stop();
    }, [opacity, delay]);

    // Ring pulse: a quick scale bump each time a cell transitions INTO the
    // selected state, springing back to rest.
    const ringScale = useRef(new Animated.Value(1)).current;
    const prevSelected = useRef(isSelected);
    useEffect(() => {
        if (prevSelected.current === isSelected) return;
        prevSelected.current = isSelected;
        if (!isSelected) {
            ringScale.setValue(1);
            return;
        }
        const pulse = Animated.sequence([
            Animated.timing(ringScale, {
                toValue: RING_PULSE_PEAK,
                duration: RING_PULSE_UP_MS,
                useNativeDriver: Platform.OS !== 'web',
            }),
            Animated.spring(ringScale, {
                toValue: 1,
                friction: RING_SPRING_FRICTION,
                tension: RING_SPRING_TENSION,
                useNativeDriver: Platform.OS !== 'web',
            }),
        ]);
        pulse.start();
        return () => pulse.stop();
    }, [isSelected, ringScale]);

    // The animated ring reads `ringScale`; its border/radius/position are inline
    // `style` because NativeWind `className` interop is not guaranteed on an
    // `Animated.View` under the RN-Web build.
    const ring = isSelected ? (
        <Animated.View
            pointerEvents="none"
            style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                borderRadius: CELL_CORNER_RADIUS,
                borderWidth: SELECTION_RING_WIDTH,
                borderColor: primaryColor,
                transform: [{ scale: ringScale }],
            }}
        />
    ) : null;

    return (
        // Animated wrapper carries the entrance opacity + layout box as inline
        // `style` (animated values must be inline, and className interop on
        // Animated.View is not guaranteed on RN-Web). `className` stays on the
        // non-animated TouchableOpacity + content below.
        <Animated.View
            style={{
                width: size,
                height: size,
                marginRight,
                marginBottom,
                position: 'relative',
                opacity,
            }}
        >
            {/* Inline `flex: 1` (not just `className="flex-1"`): on RN-Web the
                `flex-1` utility is inert on this TouchableOpacity, so the button would
                collapse to 0 height inside the fixed-size wrapper and hide the tile.
                See PhotoPickerCellContent for the full rationale. */}
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={onPress}
                onLongPress={onLongPress}
                style={{ flex: 1 }}
                className="flex-1"
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                accessibilityState={{ selected: isSelected }}
            >
                <PhotoPickerCellContent
                    photo={photo}
                    dim={dim}
                    isSelected={isSelected}
                    selectionIndex={selectionIndex}
                    primaryColor={primaryColor}
                    thumbUrl={thumbUrl}
                    ring={ring}
                />
            </TouchableOpacity>
        </Animated.View>
    );
});

const PhotoPickerCell = React.memo(function PhotoPickerCell(props: PhotoPickerCellProps) {
    // reduceMotion → the static (unanimated) cell on every platform. Otherwise
    // the RN-`Animated` cell, which now plays on web too (no Reanimated layout
    // entering, so no plugin-less RN-Web warning / no-op).
    if (props.reduceMotion) {
        return <PhotoPickerCellStatic {...props} />;
    }
    return <PhotoPickerCellAnimated {...props} />;
});

const PhotoPickerView: React.FC<PhotoPickerViewProps> = ({
    photos,
    selectedIds,
    multiSelect,
    maxSelection,
    allowUpload,
    refreshing,
    uploading,
    isPickingDocument,
    uploadProgress,
    hasMore,
    loadingMore,
    reduceMotion,
    getThumbUrl,
    primaryColor,
    isOwner,
    onTogglePhoto,
    onPreviewPhoto,
    onUpload,
    onRefresh,
    onLoadMore,
    onCancel,
    onConfirm,
    t,
}) => {
    // Grid sizing width. We PREFER the measured grid-container width (the
    // bottom-sheet content width) so tiles size to the sheet, not the device
    // screen — on wide viewports the sheet is centered/narrower than the screen.
    // But we must NEVER gate the whole grid on that measurement: `onLayout` is
    // unreliable on web (react-native-css can suppress it), and a grid that only
    // renders after a measurement can stay blank forever. So we fall back to the
    // window width until a real measurement arrives — the grid ALWAYS renders,
    // then snaps to the sheet width once `onLayout` reports it. The measured
    // wrapper carries ONLY a `style` (no `className`) to maximise the chance
    // `onLayout` fires on web.
    const { width: windowWidth } = useWindowDimensions();
    const [gridWidth, setGridWidth] = useState(0);
    const onRootLayout = useCallback((e: LayoutChangeEvent) => {
        const w = Math.round(e.nativeEvent.layout.width);
        setGridWidth((prev) => (prev === w ? prev : w));
    }, []);

    const effectiveWidth = gridWidth > 0 ? gridWidth : windowWidth;
    const { columns, cellSize, gutter } = useMemo(
        () => computePhotoGridLayout(effectiveWidth),
        [effectiveWidth],
    );

    // Map selectedIds → 1-based selection order for the badge. We freeze a
    // stable order at the time of selection: the order is the insertion
    // order of the Set (which JS preserves natively).
    const selectionOrder = useMemo(() => {
        const map = new Map<string, number>();
        let i = 1;
        for (const id of selectedIds) {
            map.set(id, i++);
        }
        return map;
    }, [selectedIds]);

    const hasAnySelection = selectedIds.size > 0;

    // Compact icon-only upload pill on narrow sheets; full pill otherwise.
    const showUploadLabel = effectiveWidth >= 360;

    const isEmpty = photos.length === 0;
    const atSelectionLimit =
        multiSelect && maxSelection != null && selectedIds.size >= maxSelection;

    const handleCellPress = useCallback(
        (photo: FileMetadata) => {
            if (Platform.OS !== 'web') {
                void hapticImpact('light');
            }
            onTogglePhoto(photo);
        },
        [onTogglePhoto],
    );

    const handleCellLongPress = useCallback(
        (photo: FileMetadata) => {
            if (Platform.OS !== 'web') {
                void hapticSelection();
            }
            onPreviewPhoto(photo);
        },
        [onPreviewPhoto],
    );

    const handleConfirm = useCallback(() => {
        if (multiSelect) {
            if (selectedIds.size === 0) return;
            if (Platform.OS !== 'web') {
                void hapticNotification('success');
            }
        }
        onConfirm();
    }, [multiSelect, selectedIds.size, onConfirm]);

    // FlatList renderItem: each cell knows its enterIndex (for stagger).
    const renderItem = useCallback(
        ({ item, index }: { item: FileMetadata; index: number }) => {
            const isSelected = selectedIds.has(item.id);
            const selIndex = isSelected ? (selectionOrder.get(item.id) || 0) : 0;
            // Last column gets no right margin; last row no bottom margin
            // (FlatList handles row breaks via numColumns).
            const isLastInRow = (index + 1) % columns === 0;
            const a11yLabel = t(
                isSelected
                    ? 'fileManagement.a11y.photoCellSelected'
                    : 'fileManagement.a11y.photoCellUnselected',
                { name: item.filename || 'photo' },
            );
            return (
                <PhotoPickerCell
                    photo={item}
                    size={cellSize}
                    marginRight={isLastInRow ? 0 : gutter}
                    marginBottom={gutter}
                    isSelected={isSelected}
                    selectionIndex={selIndex}
                    dim={
                        multiSelect
                        && !isSelected
                        && (hasAnySelection || atSelectionLimit)
                    }
                    primaryColor={primaryColor}
                    thumbUrl={getThumbUrl(item)}
                    enterIndex={index}
                    reduceMotion={reduceMotion}
                    onPress={() => handleCellPress(item)}
                    onLongPress={() => handleCellLongPress(item)}
                    a11yLabel={a11yLabel}
                />
            );
        },
        [
            selectedIds, selectionOrder, columns, cellSize, gutter, multiSelect, hasAnySelection,
            atSelectionLimit, primaryColor, getThumbUrl, reduceMotion, handleCellPress,
            handleCellLongPress, t,
        ],
    );

    const keyExtractor = useCallback((item: FileMetadata) => item.id, []);

    const listFooter = useMemo(() => {
        if (!loadingMore) return null;
        return (
            <View className="py-space-16 items-center">
                <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
        );
    }, [loadingMore]);

    const handleEndReached = useCallback(() => {
        if (loadingMore || !hasMore) return;
        onLoadMore();
    }, [loadingMore, hasMore, onLoadMore]);

    const confirmDisabled = multiSelect && selectedIds.size === 0;
    const confirmLabel = multiSelect
        ? t('fileManagement.doneWithCount', { count: selectedIds.size })
        : t('fileManagement.done');

    // The progress fill width. Guard against zero division.
    const progressFraction = uploadProgress && uploadProgress.total > 0
        ? Math.min(1, Math.max(0, uploadProgress.current / uploadProgress.total))
        : 0;

    return (
        // Measured wrapper: `style`-only (no className) so RN-Web fires onLayout.
        // The sheet is `scrollable=false` (the FlatList owns scrolling) and clamped by
        // its `maxHeight`; every flex link between it and the FlatList must SHRINK into
        // that clamp so the FlatList gets a bounded scroll area (else the list grows to
        // its content and is clipped — "renders half", no scroll).
        //
        // CRITICAL (web): shrink-into-clamp must be driven through `style`, NOT
        // `className="flex-1"`. On RN-Web every View carries a base atomic class that
        // hard-sets `flex-shrink: 0; flex-basis: auto` (and `min-height: 0`). The
        // `flex-1` utility is unreliable against it — depending on the consumer's web
        // pipeline it either never reaches the DOM or is out-ranked by that base reset,
        // so a className'd View keeps `flex-shrink: 0`, never shrinks, and grows to its
        // content (the list overflows the clamp and is clipped — "renders half", no
        // scroll). RN-Web emits inline `style` flex as a HIGHER-precedence atomic class
        // that beats the base reset, so inline `flex: 1` reliably yields `flex: 1 1 0%`.
        // No explicit `min-height: 0` is needed: RN-Web's base View already sets it (and
        // native Yoga defaults min to 0), so `flex: 1` alone shrinks into the clamp.
        <View style={{ flex: 1 }} onLayout={onRootLayout}>
            <View className="flex-1 bg-black" style={{ flex: 1 }}>
                {/* Photo grid (renders behind translucent header) */}
                {isEmpty ? (
                    <View className="flex-1 items-center justify-center px-space-32 pt-[88px]" style={{ flex: 1 }}>
                        <View className="opacity-30 mb-space-16">
                            <MaterialCommunityIcons name="image-outline" size={64} color="#FFFFFF" />
                        </View>
                        <Text className="text-white text-[17px] font-semibold text-center mb-1.5">
                            {t('fileManagement.photoPicker.emptyTitle')}
                        </Text>
                        <Text className="text-white text-[14px] font-normal text-center opacity-70 mb-space-24">
                            {t('fileManagement.photoPicker.emptySubtitle')}
                        </Text>
                        {isOwner && allowUpload && (
                            <TouchableOpacity
                                className="flex-row items-center gap-space-8 px-[22px] py-space-12 rounded-full"
                                style={{ backgroundColor: primaryColor }}
                                onPress={onUpload}
                                disabled={uploading || isPickingDocument}
                                accessibilityRole="button"
                                accessibilityLabel={t('fileManagement.uploadPhoto')}
                                accessibilityState={{ busy: uploading || isPickingDocument }}
                            >
                                {(uploading || isPickingDocument) ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <>
                                        <Ionicons name="cloud-upload" size={18} color="#FFFFFF" />
                                        <Text className="text-white text-[15px] font-semibold">
                                            {t('fileManagement.uploadPhoto')}
                                        </Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>
                ) : (
                        <FlatList
                            key={`cols-${columns}`}
                            data={photos}
                            renderItem={renderItem}
                            keyExtractor={keyExtractor}
                            numColumns={columns}
                            className="flex-1"
                            style={{ flex: 1 }}
                            contentContainerClassName="pt-[88px] pb-space-24"
                            showsVerticalScrollIndicator={false}
                            refreshControl={
                                <RefreshControl
                                    refreshing={refreshing}
                                    onRefresh={onRefresh}
                                    tintColor="#FFFFFF"
                                    colors={[primaryColor]}
                                    progressViewOffset={GRID_CONTENT_PADDING_TOP}
                                />
                            }
                            onEndReached={handleEndReached}
                            onEndReachedThreshold={0.4}
                            ListFooterComponent={listFooter}
                            removeClippedSubviews={Platform.OS !== 'web'}
                            initialNumToRender={Math.max(12, columns * 6)}
                            windowSize={9}
                        />
                )}

                {/* Translucent black header. The bottom sheet already sits below
                    the status bar, so we do NOT add `insets.top` — that would
                    double-pad. `pt-[28px]` clears the 28dp drag handle floating
                    at the top of the sheet; `min-h-[84px]` = handle + app bar.
                    `position/top/left/right/zIndex` are ALSO set inline: on RN-Web
                    the `absolute`/`top-0`/`z-30` utility classes are inert (RN-Web's
                    base View forces `position: relative; z-index: 0`), so without the
                    inline overrides the header renders in normal flow below the grid
                    instead of floating over it. Inline wins; native is unchanged. */}
                <View
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 }}
                    className="absolute top-0 left-0 right-0 flex-row items-center justify-between px-space-12 z-30 bg-[#000000EB] pt-[28px] min-h-[84px]"
                >
                    <View className="flex-row items-center justify-between w-full h-14">
                        <View className="basis-0 grow flex-row items-center justify-start">
                            <TouchableOpacity
                                onPress={onCancel}
                                className="px-1.5 py-space-8 min-h-9 min-w-11 justify-center"
                                accessibilityRole="button"
                                accessibilityLabel={t('fileManagement.a11y.cancelPicker')}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Text className="text-white text-[17px] font-medium">
                                    {t('fileManagement.cancel')}
                                </Text>
                            </TouchableOpacity>
                        </View>
                        <View pointerEvents="none">
                            <Text
                                className="text-white text-[17px] font-semibold text-center"
                                style={{ letterSpacing: -0.2 }}
                                numberOfLines={1}
                            >
                                {t('fileManagement.choosePhoto')}
                            </Text>
                        </View>
                        <View className="basis-0 grow flex-row items-center justify-end">
                            {multiSelect ? (
                                <TouchableOpacity
                                    onPress={handleConfirm}
                                    disabled={confirmDisabled}
                                    className="flex-row items-center gap-1.5 px-3.5 py-space-8 rounded-full min-h-9"
                                    style={{
                                        backgroundColor: confirmDisabled
                                            ? 'rgba(255,255,255,0.18)'
                                            : primaryColor,
                                        opacity: confirmDisabled ? 0.6 : 1,
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('fileManagement.a11y.confirmSelection')}
                                    accessibilityState={{ disabled: confirmDisabled }}
                                >
                                    <Text className="text-white text-[15px] font-semibold">
                                        {confirmLabel}
                                    </Text>
                                </TouchableOpacity>
                            ) : (
                                isOwner && allowUpload && (
                                    <TouchableOpacity
                                        onPress={onUpload}
                                        disabled={uploading || isPickingDocument}
                                        className={`flex-row items-center gap-1.5 py-space-8 rounded-full min-h-9${showUploadLabel ? ' px-3.5' : ' px-space-8 w-9 justify-center'}`}
                                        style={{ backgroundColor: primaryColor }}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('fileManagement.a11y.uploadFromDevice')}
                                        accessibilityState={{ busy: uploading || isPickingDocument }}
                                    >
                                        {(uploading || isPickingDocument) ? (
                                            <ActivityIndicator size="small" color="#FFFFFF" />
                                        ) : (
                                            <>
                                                <Ionicons name="cloud-upload" size={16} color="#FFFFFF" />
                                                {showUploadLabel && (
                                                    <Text className="text-white text-[15px] font-semibold">
                                                        {t('fileManagement.upload')}
                                                    </Text>
                                                )}
                                            </>
                                        )}
                                    </TouchableOpacity>
                                )
                            )}
                        </View>
                    </View>
                    {/* Subtle top progress bar during upload (non-blocking). */}
                    {uploading && (
                        <View className="absolute left-0 right-0 bottom-0 h-0.5 bg-[#FFFFFF1F]">
                            <View
                                className="h-full"
                                style={{
                                    width: `${Math.round(progressFraction * 100)}%`,
                                    backgroundColor: primaryColor,
                                }}
                            />
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
};

export default PhotoPickerView;
