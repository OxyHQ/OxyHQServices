import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, type LayoutChangeEvent } from 'react-native';
import type { FileMetadata } from '../../../models/interfaces';
// Using plain React Native styles (nativewind not installed in this repo)

export interface JustifiedPhotoGridProps {
    photos: FileMetadata[];
    photoDimensions: { [key: string]: { width: number; height: number } };
    loadPhotoDimensions: (photos: FileMetadata[]) => Promise<void>;
    createJustifiedRows: (photos: FileMetadata[], containerWidth: number) => FileMetadata[][];
    renderJustifiedPhotoItem: (photo: FileMetadata, width: number, height: number, isLast: boolean) => React.ReactElement;
    renderSimplePhotoItem: (photo: FileMetadata, index: number) => React.ReactElement;
    textColor: string;
    /**
     * Full available width from parent. If omitted, component will measure itself and adapt responsively.
     */
    containerWidth?: number; // optional; will auto-measure if not provided
    gap?: number;
    minRowHeight?: number;
    maxRowHeight?: number;
    dateFormatLocale?: string;
}

/**
 * Responsive justified photo grid that stretches to the provided containerWidth.
 * Uses flex rows with proportional children widths instead of absolute pixel widths so it always fills.
 */
const JustifiedPhotoGrid: React.FC<JustifiedPhotoGridProps> = ({
    photos,
    photoDimensions,
    loadPhotoDimensions,
    createJustifiedRows,
    renderJustifiedPhotoItem,
    textColor,
    containerWidth: explicitWidth,
    gap = 4,
    minRowHeight = 100,
    maxRowHeight = 300,
    dateFormatLocale = 'en-US',
}) => {
    // Responsive width measurement if not explicitly provided
    const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
    const effectiveWidth = explicitWidth ?? measuredWidth ?? 0; // 0 until measured

    const onLayoutContainer = useCallback((e: LayoutChangeEvent) => {
        if (explicitWidth) return; // ignore if controlled
        const w = e.nativeEvent.layout.width;
        setMeasuredWidth(prev => (prev === w ? prev : w));
    }, [explicitWidth]);
    // Ensure dimensions are loaded for displayed photos
    useEffect(() => {
        loadPhotoDimensions(photos);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [photos.map(p => p.id).join(',')]);

    // Group photos by date first
    const photosByDate = useMemo(() => {
        return photos.reduce((groups: { [key: string]: FileMetadata[] }, photo) => {
            const date = new Date(photo.uploadDate).toDateString();
            if (!groups[date]) groups[date] = [];
            groups[date].push(photo);
            return groups;
        }, {} as { [key: string]: FileMetadata[] });
    }, [photos]);

    const sortedDates = useMemo(() => Object.keys(photosByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), [photosByDate]);

    // Track measured width of each date section (may differ if parent applies horizontal padding/margins)
    const [dateWidths, setDateWidths] = useState<Record<string, number>>({});
    const onLayoutDate = useCallback((date: string, width: number) => {
        setDateWidths(prev => (prev[date] === width ? prev : { ...prev, [date]: width }));
    }, []);

    return (
        <View style={{ width: '100%' }} onLayout={onLayoutContainer}>
            {/* If width not yet known (uncontrolled), avoid rendering to prevent layout jump */}
            {effectiveWidth === 0 && !explicitWidth ? null : (
                <>
                    {sortedDates.map((date: string) => {
                        const dayPhotos = photosByDate[date];
                        // createJustifiedRows should build rows such that the "ideal" height (availableWidth / totalAspect) stays within min/max.
                        // We pass the effective container width.
                        const dateWidth = dateWidths[date] ?? effectiveWidth; // fallback to overall width until measured
                        const rows = dateWidth > 0 ? createJustifiedRows(dayPhotos, dateWidth) : [];
                        return (
                            <View
                                key={date}
                                style={{ marginBottom: 24, width: '100%' }}
                                onLayout={e => onLayoutDate(date, e.nativeEvent.layout.width)}
                            >
                                <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 12, color: textColor }}>
                                    {new Date(date).toLocaleDateString(dateFormatLocale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                </Text>
                                <View style={{ width: '100%' }}>
                                    {rows.map((row, rowIndex) => {
                                        // Compute total aspect ratios using loaded dimensions (fallback 4/3)
                                        const aspects = row.map(p => {
                                            const dims = photoDimensions[p.id];
                                            return dims ? dims.width / dims.height : 4 / 3;
                                        });
                                        const totalAspect = aspects.reduce((a, b) => a + b, 0);
                                        const gapsTotal = gap * (row.length - 1);
                                        const availableWidth = dateWidth - gapsTotal;
                                        // Ideal height that perfectly fills width when preserving aspect ratios
                                        const idealHeight = availableWidth / totalAspect;
                                        // We rely on row construction keeping idealHeight within min/max bounds; if not, clamp but then distribute leftover/overflow.
                                        let rowHeight = idealHeight;
                                        let widthAdjustment = 0; // difference to distribute if clamped
                                        if (idealHeight < minRowHeight) {
                                            rowHeight = minRowHeight;
                                            widthAdjustment = availableWidth - rowHeight * totalAspect; // negative means overflow
                                        } else if (idealHeight > maxRowHeight) {
                                            rowHeight = maxRowHeight;
                                            widthAdjustment = availableWidth - rowHeight * totalAspect;
                                        }

                                        // Pre-compute widths maintaining aspect ratios
                                        let widths = aspects.map(ar => ar * rowHeight);
                                        // If we have widthAdjustment (due to clamping) distribute proportionally so row still fills exactly
                                        if (widthAdjustment !== 0) {
                                            const widthSum = widths.reduce((a, b) => a + b, 0);
                                            widths = widths.map(w => w + (w / widthSum) * widthAdjustment);
                                        }

                                        // To combat rounding issues, adjust last item width to fill precisely
                                        const widthSumRounded = widths.reduce((a, b) => a + b, 0);
                                        const roundingDiff = availableWidth - widthSumRounded;
                                        if (Math.abs(roundingDiff) > 0.5) {
                                            widths[widths.length - 1] += roundingDiff; // minimal correction
                                        }

                                        return (
                                            <View key={rowIndex} style={{ flexDirection: 'row', width: '100%', marginBottom: 4 }}>
                                                {row.map((p, i) => {
                                                    const photoWidth = widths[i];
                                                    return (
                                                        <View
                                                            key={p.id}
                                                            style={{ width: photoWidth, height: rowHeight, marginRight: i === row.length - 1 ? 0 : gap }}
                                                        >
                                                            {renderJustifiedPhotoItem(p, photoWidth, rowHeight, i === row.length - 1)}
                                                        </View>
                                                    );
                                                })}
                                            </View>
                                        );
                                    })}
                                </View>
                            </View>
                        );
                    })}
                </>
            )}
        </View>
    );
};

export default React.memo(JustifiedPhotoGrid);
