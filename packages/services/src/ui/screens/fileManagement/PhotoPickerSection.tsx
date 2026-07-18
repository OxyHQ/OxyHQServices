import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    FlatList,
    Platform,
    type LayoutChangeEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Reanimated, {
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
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
 * A single photo cell. Memoized so re-renders during selection only touch
 * affected cells — selection of one photo must not redraw the whole grid.
 *
 * Apple Photos pattern: when any cell is selected, *non-selected* siblings
 * fade to 0.6 opacity to focus attention on the active selection.
 */
const PhotoPickerCell = React.memo(function PhotoPickerCell(props: {
    photo: FileMetadata;
    size: number;
    marginRight: number;
    marginBottom: number;
    isSelected: boolean;
    selectionIndex: number; // 1-based for badge; 0 if not selected
    dim: boolean; // any selection exists and this cell is not selected
    primaryColor: string;
    thumbUrl: string | undefined;
    enterIndex: number;
    reduceMotion: boolean;
    onPress: () => void;
    onLongPress: () => void;
    a11yLabel: string;
}) {
    const {
        photo, size, marginRight, marginBottom, isSelected, selectionIndex,
        dim, primaryColor, thumbUrl, enterIndex, reduceMotion, onPress,
        onLongPress, a11yLabel,
    } = props;

    // Cap the cumulative stagger at ~800ms total so the very long grid does
    // not keep fading in late tiles. Beyond ~53 tiles the delay maxes out.
    const STAGGER_PER_CELL_MS = 15;
    const MAX_TOTAL_STAGGER_MS = 800;
    const delay = Math.min(enterIndex * STAGGER_PER_CELL_MS, MAX_TOTAL_STAGGER_MS);

    // Selection ring pulse animation: 1.0 → 1.05 → 1.0 on transition to
    // selected. Plays at most once per selection change; reduce-motion skips.
    const ringScale = useSharedValue(1);
    const prevSelected = useRef(isSelected);
    useEffect(() => {
        if (prevSelected.current === isSelected) return;
        prevSelected.current = isSelected;
        if (!isSelected) {
            ringScale.value = 1;
            return;
        }
        if (reduceMotion) {
            ringScale.value = 1;
            return;
        }
        ringScale.value = withSequence(
            withTiming(1.05, { duration: 110 }),
            withSpring(1, { damping: 14, stiffness: 200 }),
        );
    }, [isSelected, reduceMotion, ringScale]);

    const ringAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: ringScale.value }],
    }));

    // Per-tile pixel geometry is derived from the measured grid width, so it
    // stays an inline `style` — NativeWind cannot express a runtime pixel size.
    const cellWrapperStyle = {
        width: size,
        height: size,
        marginRight,
        marginBottom,
    };

    const inner = (
        <>
            <View
                className={`flex-1 rounded-radius-8 overflow-hidden bg-[#111111]${dim ? ' opacity-60' : ''}`}
            >
                <ExpoImage
                    source={{ uri: thumbUrl }}
                    // expo-image is a third-party component (no NativeWind
                    // className remap), so fill via inline style.
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    transition={120}
                    cachePolicy="memory-disk"
                    accessibilityLabel={photo.filename}
                />
            </View>
            {isSelected && (
                <Reanimated.View
                    pointerEvents="none"
                    className="absolute inset-0 rounded-radius-8 border-[3px]"
                    // borderColor is the theme primary (dynamic); the animated
                    // scale transform must ride on `style` too.
                    style={[{ borderColor: primaryColor }, ringAnimatedStyle]}
                />
            )}
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

    if (reduceMotion) {
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
                {inner}
            </TouchableOpacity>
        );
    }

    return (
        <Reanimated.View
            entering={FadeIn.delay(delay).duration(200)}
            className="relative"
            style={cellWrapperStyle}
        >
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={onPress}
                onLongPress={onLongPress}
                className="flex-1"
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                accessibilityState={{ selected: isSelected }}
            >
                {inner}
            </TouchableOpacity>
        </Reanimated.View>
    );
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
    // Measure the grid CONTAINER (the bottom-sheet content width), NOT the
    // device screen. On wide viewports the sheet is centered/narrower than the
    // screen, so screen-width tile math overflows. The measured wrapper carries
    // ONLY a `style` (no `className`) because RN-Web does not fire `onLayout`
    // for `className`'d nodes.
    const [gridWidth, setGridWidth] = useState(0);
    const onRootLayout = useCallback((e: LayoutChangeEvent) => {
        const w = Math.round(e.nativeEvent.layout.width);
        setGridWidth((prev) => (prev === w ? prev : w));
    }, []);

    const { columns, cellSize, gutter } = useMemo(
        () => computePhotoGridLayout(gridWidth),
        [gridWidth],
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
    // Defaults to the full label until the sheet width has been measured.
    const showUploadLabel = gridWidth === 0 || gridWidth >= 360;

    const isEmpty = photos.length === 0;
    // Only mount the grid once a real container width is known, so columns /
    // tile size derive from the sheet width instead of a placeholder.
    const gridReady = gridWidth > 0 && cellSize > 0;
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
        <View style={{ flex: 1 }} onLayout={onRootLayout}>
            <View className="flex-1 bg-black">
                {/* Photo grid (renders behind translucent header) */}
                {isEmpty ? (
                    <View className="flex-1 items-center justify-center px-space-32 pt-[88px]">
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
                ) : !gridReady ? (
                    <View className="flex-1 items-center justify-center pt-[88px]">
                        <ActivityIndicator size="large" color="#FFFFFF" />
                        <Text className="text-white text-[14px] mt-space-12 opacity-70">
                            {t('fileManagement.loadingPhotoLayout')}
                        </Text>
                    </View>
                ) : (
                        <FlatList
                            key={`cols-${columns}`}
                            data={photos}
                            renderItem={renderItem}
                            keyExtractor={keyExtractor}
                            numColumns={columns}
                            className="flex-1"
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
                            removeClippedSubviews
                            initialNumToRender={Math.max(12, columns * 6)}
                            windowSize={9}
                        />
                )}

                {/* Translucent black header. The bottom sheet already sits below
                    the status bar, so we do NOT add `insets.top` — that would
                    double-pad. `pt-[28px]` clears the 28dp drag handle floating
                    at the top of the sheet; `min-h-[84px]` = handle + app bar. */}
                <View className="absolute top-0 left-0 right-0 flex-row items-center justify-between px-space-12 z-30 bg-[#000000EB] pt-[28px] min-h-[84px]">
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
                                className="text-white text-[17px] font-semibold text-center tracking-[-0.2px]"
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
