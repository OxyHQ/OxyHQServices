import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    FlatList,
    Platform,
    useWindowDimensions,
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
import { photoPickerStyles } from '../../components/fileManagement/styles';

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

    const inner = (
        <>
            <View style={[photoPickerStyles.cellInner, dim && photoPickerStyles.cellDim]}>
                <ExpoImage
                    source={{ uri: thumbUrl }}
                    style={photoPickerStyles.cellImage}
                    contentFit="cover"
                    transition={120}
                    cachePolicy="memory-disk"
                    accessibilityLabel={photo.filename}
                />
            </View>
            {isSelected && (
                <Reanimated.View
                    pointerEvents="none"
                    style={[
                        photoPickerStyles.cellRing,
                        { borderColor: primaryColor },
                        ringAnimatedStyle,
                    ]}
                />
            )}
            {isSelected && (
                <View
                    pointerEvents="none"
                    style={[photoPickerStyles.cellBadge, { backgroundColor: primaryColor }]}
                >
                    <Text style={photoPickerStyles.cellBadgeText}>
                        {selectionIndex > 0 ? String(selectionIndex) : ''}
                    </Text>
                </View>
            )}
        </>
    );

    const cellWrapperStyle = {
        width: size,
        height: size,
        marginRight,
        marginBottom,
    };

    if (reduceMotion) {
        return (
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={onPress}
                onLongPress={onLongPress}
                style={[photoPickerStyles.cellWrapper, cellWrapperStyle]}
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
            style={[photoPickerStyles.cellWrapper, cellWrapperStyle]}
        >
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={onPress}
                onLongPress={onLongPress}
                style={{ flex: 1 }}
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
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();

    // Layout: 3 columns phone portrait, 2 columns phone landscape,
    // 4 columns tablet (>= 600 width). Apple Photos-ish.
    const columns = useMemo(() => {
        if (windowWidth >= 600) return 4;
        // Landscape phone: width > height
        if (windowWidth > windowHeight) return 2;
        return 3;
    }, [windowWidth, windowHeight]);

    const GUTTER = 2;
    const cellSize = useMemo(() => {
        // (windowWidth - (columns - 1) * GUTTER) / columns, but
        // FlatList in 3-col layout means each row has 2 inter-cell gutters.
        return Math.floor((windowWidth - GUTTER * (columns - 1)) / columns);
    }, [windowWidth, columns]);

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

    // Compact icon-only upload pill on narrow screens; full pill otherwise.
    const showUploadLabel = windowWidth >= 360;

    // The bottom sheet renders below the status bar already (its `maxHeight`
    // is capped by `SCREEN_HEIGHT - insets.top`), so the picker MUST NOT add
    // an additional safe-area inset to the header. Header layout:
    //   • 28dp drag-handle hit area floats at the very top of the sheet
    //   • 56dp app bar sits immediately below the handle
    // Total header zone = 28 + 56 = 84dp from sheet top.
    const HANDLE_ZONE = 28;
    const APP_BAR_HEIGHT = 56;
    const headerHeight = HANDLE_ZONE + APP_BAR_HEIGHT;
    const contentPaddingTop = headerHeight + 4;

    const isEmpty = photos.length === 0;
    const a11yColumnsAnnouncement = useRef<number>(columns);

    useEffect(() => {
        if (a11yColumnsAnnouncement.current !== columns) {
            a11yColumnsAnnouncement.current = columns;
        }
    }, [columns]);

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
                    marginRight={isLastInRow ? 0 : GUTTER}
                    marginBottom={GUTTER}
                    isSelected={isSelected}
                    selectionIndex={selIndex}
                    dim={multiSelect && hasAnySelection && !isSelected}
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
            selectedIds, selectionOrder, columns, cellSize, multiSelect, hasAnySelection,
            primaryColor, getThumbUrl, reduceMotion, handleCellPress, handleCellLongPress, t,
        ],
    );

    const keyExtractor = useCallback((item: FileMetadata) => item.id, []);

    const listFooter = useMemo(() => {
        if (!loadingMore) return null;
        return (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
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
        <View style={photoPickerStyles.root}>
            {/* Photo grid (renders behind translucent header) */}
            {isEmpty ? (
                <View style={[photoPickerStyles.empty, { paddingTop: contentPaddingTop }]}>
                    <View style={photoPickerStyles.emptyIconWrap}>
                        <MaterialCommunityIcons name="image-outline" size={64} color="#FFFFFF" />
                    </View>
                    <Text style={[photoPickerStyles.emptyTitle, { color: '#FFFFFF' }]}>
                        {t('fileManagement.photoPicker.emptyTitle')}
                    </Text>
                    <Text style={[photoPickerStyles.emptySubtitle, { color: '#FFFFFF' }]}>
                        {t('fileManagement.photoPicker.emptySubtitle')}
                    </Text>
                    {isOwner && allowUpload && (
                        <TouchableOpacity
                            style={[photoPickerStyles.emptyCta, { backgroundColor: primaryColor }]}
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
                                    <Text style={photoPickerStyles.emptyCtaText}>
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
                    contentContainerStyle={[
                        photoPickerStyles.gridContent,
                        { paddingTop: contentPaddingTop },
                    ]}
                    style={photoPickerStyles.grid}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor="#FFFFFF"
                            colors={[primaryColor]}
                            progressViewOffset={contentPaddingTop}
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
                the status bar, so we do NOT add `insets.top` here — that would
                double-pad. `paddingTop: HANDLE_ZONE` clears the 28dp drag
                handle floating at the top of the sheet. */}
            <View
                style={[
                    photoPickerStyles.header,
                    { paddingTop: HANDLE_ZONE, minHeight: headerHeight },
                ]}
            >
                <View style={photoPickerStyles.headerRow}>
                    <View style={[photoPickerStyles.headerSide, photoPickerStyles.headerSideLeft]}>
                        <TouchableOpacity
                            onPress={onCancel}
                            style={photoPickerStyles.headerCancel}
                            accessibilityRole="button"
                            accessibilityLabel={t('fileManagement.a11y.cancelPicker')}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Text style={photoPickerStyles.headerCancelText}>
                                {t('fileManagement.cancel')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    <View pointerEvents="none">
                        <Text style={photoPickerStyles.headerTitle} numberOfLines={1}>
                            {t('fileManagement.choosePhoto')}
                        </Text>
                    </View>
                    <View style={[photoPickerStyles.headerSide, photoPickerStyles.headerSideRight]}>
                        {multiSelect ? (
                            <TouchableOpacity
                                onPress={handleConfirm}
                                disabled={confirmDisabled}
                                style={[
                                    photoPickerStyles.headerPrimaryPill,
                                    {
                                        backgroundColor: confirmDisabled
                                            ? 'rgba(255,255,255,0.18)'
                                            : primaryColor,
                                        opacity: confirmDisabled ? 0.6 : 1,
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={t('fileManagement.a11y.confirmSelection')}
                                accessibilityState={{ disabled: confirmDisabled }}
                            >
                                <Text style={photoPickerStyles.headerPrimaryText}>
                                    {confirmLabel}
                                </Text>
                            </TouchableOpacity>
                        ) : (
                            isOwner && allowUpload && (
                                <TouchableOpacity
                                    onPress={onUpload}
                                    disabled={uploading || isPickingDocument}
                                    style={[
                                        photoPickerStyles.headerPrimaryPill,
                                        !showUploadLabel && photoPickerStyles.headerPrimaryPillIconOnly,
                                        { backgroundColor: primaryColor },
                                    ]}
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
                                                <Text style={photoPickerStyles.headerPrimaryText}>
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
                    <View style={photoPickerStyles.headerProgressBarTrack}>
                        <View
                            style={[
                                photoPickerStyles.headerProgressBarFill,
                                {
                                    width: `${Math.round(progressFraction * 100)}%`,
                                    backgroundColor: primaryColor,
                                },
                            ]}
                        />
                    </View>
                )}
            </View>
        </View>
    );
};

export default PhotoPickerView;
