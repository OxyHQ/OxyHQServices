import type React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    RefreshControl,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FileMetadata } from '@oxyhq/core';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { useTheme } from '@oxyhq/bloom/theme';
import { fileManagementStyles } from '../../components/fileManagement/styles';

type ThemeColors = ReturnType<typeof useTheme>['colors'];

/** A pre-built list row descriptor (produced by the orchestrator's memo). */
export interface FileListItem {
    id: string;
    icon?: React.ReactNode;
    title: string;
    description?: string;
    onPress: () => void;
    rightElement?: React.ReactNode;
}

export interface FileListSectionProps {
    scrollViewRef: React.RefObject<ScrollView | null>;
    filteredFiles: FileMetadata[];
    searchQuery: string;
    items: FileListItem[];
    paging: { loadingMore: boolean; hasMore: boolean };
    refreshing: boolean;
    colors: ThemeColors;
    t: (key: string, vars?: Record<string, string | number>) => string;
    onRefresh: () => void;
    onLoadMore: () => void;
    onClearSearch: () => void;
    /** Rendered when there are no files at all (not a search miss). */
    renderEmptyState: () => React.ReactNode;
}

/**
 * The non-photo file list (list-style `all`/`videos`/`documents`/`audio`
 * views). Extracted verbatim from FileManagementScreen — the orchestrator
 * still owns the item construction and pagination logic and threads them in.
 */
const FileListSection: React.FC<FileListSectionProps> = ({
    scrollViewRef,
    filteredFiles,
    searchQuery,
    items,
    paging,
    refreshing,
    colors,
    t,
    onRefresh,
    onLoadMore,
    onClearSearch,
    renderEmptyState,
}) => {
    return (
        <ScrollView
            ref={scrollViewRef}
            style={fileManagementStyles.scrollView}
            contentContainerStyle={fileManagementStyles.scrollContainer}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    tintColor={colors.primary}
                />
            }
            onScroll={({ nativeEvent }) => {
                const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
                if (distanceFromBottom < 200 && !paging.loadingMore && paging.hasMore) {
                    onLoadMore();
                }
            }}
            scrollEventThrottle={250}
        >
            {filteredFiles.length === 0 && searchQuery.length > 0 ? (
                <View style={fileManagementStyles.emptyState}>
                    <Ionicons name="search" size={64} color={colors.textTertiary} />
                    <Text style={[fileManagementStyles.emptyStateTitle, { color: colors.text }]}>{t('fileManagement.noResults.title')}</Text>
                    <Text style={[fileManagementStyles.emptyStateDescription, { color: colors.textSecondary }]}>
                        {t('fileManagement.noResults.description', { query: searchQuery })}
                    </Text>
                    <TouchableOpacity
                        style={[fileManagementStyles.emptyStateButton, { backgroundColor: colors.primary }]}
                        onPress={onClearSearch}
                    >
                        <Ionicons name="refresh" size={20} color="#FFFFFF" />
                        <Text style={fileManagementStyles.emptyStateButtonText}>{t('fileManagement.clearSearch')}</Text>
                    </TouchableOpacity>
                </View>
            ) : filteredFiles.length === 0 ? renderEmptyState() : (
                <>
                    <SettingsListGroup>
                        {items.map(item => (
                            <SettingsListItem
                                key={item.id}
                                icon={item.icon}
                                title={item.title}
                                description={item.description}
                                onPress={item.onPress}
                                showChevron={false}
                                rightElement={item.rightElement}
                            />
                        ))}
                    </SettingsListGroup>
                    {paging.loadingMore && (
                        <View style={fileManagementStyles.loadingMoreBar}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={[fileManagementStyles.loadingMoreText, { color: colors.text }]}>{t('fileManagement.loadingMore')}</Text>
                        </View>
                    )}
                </>
            )}
        </ScrollView>
    );
};

export default FileListSection;
