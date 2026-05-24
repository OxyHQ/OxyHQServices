import React, { useCallback, useMemo, useState } from 'react';
import {
    View,
    StyleSheet,
    ActivityIndicator,
    TouchableOpacity,
    Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader, AccountCard } from '@/components/ui';
import { useOxy, useInfiniteSecurityActivity } from '@oxyhq/services';
import { Section } from '@/components/section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useTranslation } from '@/lib/i18n';
import type { SecurityActivity, SecurityEventType } from '@oxyhq/core';
import {
    getEventIcon,
    getSeverityColor,
    getEventSeverity,
} from '@/utils/security-utils';
import type { MaterialCommunityIconName } from '@/types/icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { darkenColor } from '@/utils/color-utils';

/** Page size for the infinite query. */
const PAGE_SIZE = 30;

/**
 * Map a backend `SecurityEventType` to the localized activity label key.
 *
 * The spec includes labels the backend does not yet emit (passwordChange,
 * twoFactorEnabled, twoFactorDisabled, privacyUpdate) — these are wired up
 * so that once the API starts emitting them they will render with the right
 * copy without further changes here.
 */
function getEventLabelKey(eventType: SecurityEventType | string): string {
    switch (eventType) {
        case 'sign_in':
            return 'activity.events.signIn';
        case 'sign_out':
            return 'activity.events.signOut';
        case 'email_changed':
            return 'activity.events.emailChanged';
        case 'profile_updated':
            return 'activity.events.profileUpdate';
        case 'device_added':
            return 'activity.events.deviceAdded';
        case 'device_removed':
            return 'activity.events.deviceRemoved';
        case 'account_recovery':
            return 'activity.events.accountRecovery';
        case 'security_settings_changed':
            return 'activity.events.privacyUpdate';
        case 'private_key_exported':
            return 'activity.events.keyExported';
        case 'backup_created':
            return 'activity.events.backupCreated';
        case 'suspicious_activity':
            return 'activity.events.suspicious';
        case 'password_changed':
            return 'activity.events.passwordChange';
        case 'two_factor_enabled':
            return 'activity.events.twoFactorEnabled';
        case 'two_factor_disabled':
            return 'activity.events.twoFactorDisabled';
        default:
            return 'activity.events.unknown';
    }
}

/** Stable Intl date formatters keyed by locale. */
function useDayFormatters(locale: string) {
    return useMemo(
        () => ({
            longDay: new Intl.DateTimeFormat(locale, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            }),
            shortDay: new Intl.DateTimeFormat(locale, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            }),
            time: new Intl.DateTimeFormat(locale, {
                hour: 'numeric',
                minute: '2-digit',
            }),
            relative:
                typeof Intl !== 'undefined' &&
                typeof Intl.RelativeTimeFormat === 'function'
                    ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
                    : null,
        }),
        [locale],
    );
}

type DayFormatters = ReturnType<typeof useDayFormatters>;

/** Group label for an event timestamp — Google-style buckets. */
type GroupKey =
    | { kind: 'today' }
    | { kind: 'yesterday' }
    | { kind: 'last7Days' }
    | { kind: 'date'; year: number; month: number; day: number };

function getGroupKey(date: Date, now: Date): GroupKey {
    const startOfDay = (d: Date): number =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor((startOfDay(now) - startOfDay(date)) / dayMs);

    if (diffDays <= 0) return { kind: 'today' };
    if (diffDays === 1) return { kind: 'yesterday' };
    if (diffDays < 7) return { kind: 'last7Days' };
    return {
        kind: 'date',
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
    };
}

function groupKeyToId(key: GroupKey): string {
    if (key.kind === 'date') return `date-${key.year}-${key.month}-${key.day}`;
    return key.kind;
}

interface ActivityGroup {
    key: GroupKey;
    id: string;
    title: string;
    activities: SecurityActivity[];
}

export default function ActivityScreen() {
    const colors = useColors();
    const { mode } = useTheme();
    const { t, locale } = useTranslation();
    // Auth is enforced by the `(tabs)` layout — we can assume a session here.
    const { isLoading: oxyLoading } = useOxy();
    const handlePressIn = useHapticPress();
    const [refreshing, setRefreshing] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const formatters = useDayFormatters(locale);

    const {
        data,
        isLoading,
        isError,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        refetch,
    } = useInfiniteSecurityActivity({
        limit: PAGE_SIZE,
    });

    const activities = useMemo<SecurityActivity[]>(() => {
        if (!data?.pages) return [];
        const all: SecurityActivity[] = [];
        for (const page of data.pages) {
            for (const event of page.data) {
                all.push(event);
            }
        }
        return all;
    }, [data]);

    /** Format a single timestamp into a human-readable relative string. */
    const formatRelativeTime = useCallback(
        (dateString: string): string => {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const minutes = Math.floor(diffMs / 60000);

            if (minutes < 1) return t('activity.time.justNow');
            if (minutes < 60) {
                if (formatters.relative) {
                    return formatters.relative.format(-minutes, 'minute');
                }
                return t('activity.time.minutesAgo', { count: minutes });
            }
            const hours = Math.floor(minutes / 60);
            if (hours < 24) {
                if (formatters.relative) {
                    return formatters.relative.format(-hours, 'hour');
                }
                return t('activity.time.hoursAgo', { count: hours });
            }
            const days = Math.floor(hours / 24);
            if (days < 7) {
                if (formatters.relative) {
                    return formatters.relative.format(-days, 'day');
                }
                return t('activity.time.daysAgo', { count: days });
            }
            return formatters.shortDay.format(date);
        },
        [formatters, t],
    );

    /** Group sorted activities by day bucket, preserving server order. */
    const groups = useMemo<ActivityGroup[]>(() => {
        if (activities.length === 0) return [];
        const now = new Date();
        const buckets = new Map<string, ActivityGroup>();
        const order: string[] = [];

        for (const event of activities) {
            const date = new Date(event.timestamp);
            if (Number.isNaN(date.getTime())) continue;
            const key = getGroupKey(date, now);
            const id = groupKeyToId(key);

            let bucket = buckets.get(id);
            if (!bucket) {
                let title: string;
                if (key.kind === 'today') {
                    title = t('activity.groups.today');
                } else if (key.kind === 'yesterday') {
                    title = t('activity.groups.yesterday');
                } else if (key.kind === 'last7Days') {
                    title = t('activity.groups.last7Days');
                } else {
                    title = formatters.longDay.format(date);
                }
                bucket = { key, id, title, activities: [] };
                buckets.set(id, bucket);
                order.push(id);
            }
            bucket.activities.push(event);
        }

        const result: ActivityGroup[] = [];
        for (const id of order) {
            const bucket = buckets.get(id);
            if (bucket) result.push(bucket);
        }
        return result;
    }, [activities, formatters, t]);

    /** Localized title for a single event. */
    const getEventTitle = useCallback(
        (event: SecurityActivity): string => {
            const labelKey = getEventLabelKey(event.eventType);
            const localized = t(labelKey);
            // If no translation is registered, `t` returns the raw key as a
            // visible fallback. Fall back to the server-provided description
            // for any unknown event type so the row is never empty.
            if (localized === labelKey) {
                return event.eventDescription || t('activity.events.unknown');
            }
            return localized;
        },
        [t],
    );

    /** Row subtitle (relative time + optional IP / device name). */
    const getEventSubtitle = useCallback(
        (event: SecurityActivity): string => {
            const relative = formatRelativeTime(event.timestamp);
            const ip = event.ipAddress;
            const deviceName =
                event.metadata && typeof event.metadata === 'object'
                    ? (event.metadata as { deviceName?: unknown }).deviceName
                    : undefined;
            const deviceLabel = typeof deviceName === 'string' ? deviceName : null;

            if (deviceLabel && ip) {
                return `${relative} • ${deviceLabel} • ${ip}`;
            }
            if (deviceLabel) return `${relative} • ${deviceLabel}`;
            if (ip) return `${relative} • ${ip}`;
            return relative;
        },
        [formatRelativeTime],
    );

    const handleToggleExpand = useCallback((eventId: string) => {
        setExpandedId((current) => (current === eventId ? null : eventId));
    }, []);

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await refetch();
        } finally {
            setRefreshing(false);
        }
    }, [refetch]);

    const handleLoadMore = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const handleRetry = useCallback(() => {
        refetch();
    }, [refetch]);

    const showInitialLoading =
        (isLoading || oxyLoading) && activities.length === 0;
    const isEmpty = !showInitialLoading && !isError && activities.length === 0;

    return (
        <ScreenContentWrapper refreshing={refreshing} onRefresh={handleRefresh}>
            <View
                style={[styles.container, { backgroundColor: colors.background }]}
            >
                <View style={styles.content}>
                    <ScreenHeader
                        title={t('activity.title')}
                        subtitle={t('activity.subtitle')}
                    />

                    {showInitialLoading ? (
                        <View style={styles.centeredState}>
                            <ActivityIndicator size="large" color={colors.tint} />
                            <ThemedText
                                style={[styles.centeredText, { color: colors.text }]}
                            >
                                {t('activity.loading')}
                            </ThemedText>
                        </View>
                    ) : isError ? (
                        <AccountCard>
                            <View style={styles.centeredState}>
                                <MaterialCommunityIcons
                                    name="alert-circle-outline"
                                    size={40}
                                    color={colors.error}
                                    style={styles.emptyIcon}
                                />
                                <ThemedText
                                    style={[styles.emptyTitle, { color: colors.text }]}
                                >
                                    {t('activity.errorTitle')}
                                </ThemedText>
                                <ThemedText
                                    style={[
                                        styles.emptySubtitle,
                                        { color: colors.textSecondary },
                                    ]}
                                >
                                    {error?.message ?? t('activity.errorMessage')}
                                </ThemedText>
                                <TouchableOpacity
                                    style={[
                                        styles.retryButton,
                                        { backgroundColor: colors.tint },
                                    ]}
                                    onPressIn={handlePressIn}
                                    onPress={handleRetry}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('activity.retry')}
                                >
                                    <ThemedText
                                        style={[
                                            styles.retryButtonText,
                                            { color: '#FFFFFF' },
                                        ]}
                                    >
                                        {t('activity.retry')}
                                    </ThemedText>
                                </TouchableOpacity>
                            </View>
                        </AccountCard>
                    ) : isEmpty ? (
                        <AccountCard>
                            <View style={styles.centeredState}>
                                <MaterialCommunityIcons
                                    name="shield-check-outline"
                                    size={40}
                                    color={colors.text}
                                    style={styles.emptyIcon}
                                />
                                <ThemedText
                                    style={[styles.emptyTitle, { color: colors.text }]}
                                >
                                    {t('activity.empty.title')}
                                </ThemedText>
                                <ThemedText
                                    style={[
                                        styles.emptySubtitle,
                                        { color: colors.textSecondary },
                                    ]}
                                >
                                    {t('activity.empty.subtitle')}
                                </ThemedText>
                            </View>
                        </AccountCard>
                    ) : (
                        <>
                            {groups.map((group) => (
                                <Section key={group.id} title={group.title}>
                                    <AccountCard>
                                        <View>
                                            {group.activities.map((event, index) => (
                                                <ActivityRow
                                                    key={event.id}
                                                    event={event}
                                                    title={getEventTitle(event)}
                                                    subtitle={getEventSubtitle(event)}
                                                    severityMode={mode}
                                                    isExpanded={expandedId === event.id}
                                                    onToggle={handleToggleExpand}
                                                    isFirst={index === 0}
                                                    isLast={
                                                        index === group.activities.length - 1
                                                    }
                                                    formatters={formatters}
                                                    t={t}
                                                    onPressIn={handlePressIn}
                                                />
                                            ))}
                                        </View>
                                    </AccountCard>
                                </Section>
                            ))}

                            {hasNextPage && (
                                <View style={styles.loadMoreContainer}>
                                    {isFetchingNextPage ? (
                                        <ActivityIndicator
                                            size="small"
                                            color={colors.tint}
                                        />
                                    ) : (
                                        <TouchableOpacity
                                            style={[
                                                styles.loadMoreButton,
                                                {
                                                    backgroundColor: colors.card,
                                                    borderColor: colors.border,
                                                },
                                            ]}
                                            onPressIn={handlePressIn}
                                            onPress={handleLoadMore}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('activity.loadMore')}
                                        >
                                            <ThemedText
                                                style={[
                                                    styles.loadMoreText,
                                                    { color: colors.text },
                                                ]}
                                            >
                                                {t('activity.loadMore')}
                                            </ThemedText>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                        </>
                    )}
                </View>
            </View>
        </ScreenContentWrapper>
    );
}

interface ActivityRowProps {
    event: SecurityActivity;
    title: string;
    subtitle: string;
    severityMode: 'light' | 'dark';
    isExpanded: boolean;
    onToggle: (eventId: string) => void;
    isFirst: boolean;
    isLast: boolean;
    formatters: DayFormatters;
    t: (key: string, vars?: Record<string, string | number>) => string;
    onPressIn?: () => void;
}

/**
 * Single activity row with optional expand-to-show-details. The row mimics
 * the visual style of `GroupedItem` (used by `sessions.tsx` et al.) but adds
 * a details panel below the row when tapped.
 */
function ActivityRow({
    event,
    title,
    subtitle,
    severityMode,
    isExpanded,
    onToggle,
    isFirst,
    isLast,
    formatters,
    t,
    onPressIn,
}: ActivityRowProps) {
    const colors = useColors();
    const severity = event.severity || getEventSeverity(event.eventType);
    const iconName: MaterialCommunityIconName = getEventIcon(event.eventType);
    const iconColor = getSeverityColor(severity, severityMode);

    const containerStyle = [
        styles.row,
        isFirst && styles.rowFirst,
        isLast && !isExpanded && styles.rowLast,
        {
            backgroundColor: colors.card,
        },
    ];

    const a11yLabel = `${title}, ${subtitle}`;
    const a11yHint = isExpanded
        ? t('a11y.activityCollapse')
        : t('a11y.activityExpand');

    return (
        <View
            style={[
                isFirst && styles.outerFirst,
                isLast && styles.outerLast,
                { backgroundColor: colors.card },
            ]}
        >
            <TouchableOpacity
                style={containerStyle}
                onPressIn={onPressIn}
                onPress={() => onToggle(event.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                accessibilityHint={a11yHint}
                accessibilityState={{ expanded: isExpanded }}
            >
                <View
                    style={[styles.iconContainer, { backgroundColor: iconColor }]}
                >
                    <MaterialCommunityIcons
                        name={iconName}
                        size={22}
                        color={darkenColor(iconColor)}
                    />
                </View>
                <View style={styles.textContainer}>
                    <ThemedText
                        style={[styles.rowTitle, { color: colors.text }]}
                        numberOfLines={1}
                    >
                        {title}
                    </ThemedText>
                    <ThemedText
                        style={[
                            styles.rowSubtitle,
                            { color: colors.textSecondary },
                        ]}
                        numberOfLines={2}
                    >
                        {subtitle}
                    </ThemedText>
                </View>
                <MaterialCommunityIcons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.icon}
                />
            </TouchableOpacity>

            {isExpanded && (
                <ActivityDetailsPanel
                    event={event}
                    formatters={formatters}
                    t={t}
                    isLast={isLast}
                />
            )}

            {!isLast && (
                <View
                    style={[styles.divider, { backgroundColor: colors.border }]}
                />
            )}
        </View>
    );
}

interface ActivityDetailsPanelProps {
    event: SecurityActivity;
    formatters: DayFormatters;
    t: (key: string, vars?: Record<string, string | number>) => string;
    isLast: boolean;
}

/**
 * Expanded detail panel rendered below an activity row. Lists known
 * metadata fields as key/value pairs.
 */
function ActivityDetailsPanel({
    event,
    formatters,
    t,
    isLast,
}: ActivityDetailsPanelProps) {
    const colors = useColors();
    const timestamp = new Date(event.timestamp);
    const validTimestamp = !Number.isNaN(timestamp.getTime());

    interface DetailRow {
        key: string;
        label: string;
        value: string;
    }

    const rows: DetailRow[] = [];

    rows.push({
        key: 'type',
        label: t('activity.details.type'),
        value: event.eventType,
    });
    rows.push({
        key: 'severity',
        label: t('activity.details.severity'),
        value: event.severity,
    });
    if (validTimestamp) {
        rows.push({
            key: 'time',
            label: t('activity.details.time'),
            value: `${formatters.longDay.format(
                timestamp,
            )} — ${formatters.time.format(timestamp)}`,
        });
    }
    if (event.ipAddress) {
        rows.push({
            key: 'ip',
            label: t('activity.details.ip'),
            value: event.ipAddress,
        });
    }
    if (event.userAgent) {
        rows.push({
            key: 'ua',
            label: t('activity.details.browser'),
            value: event.userAgent,
        });
    }
    if (event.deviceId) {
        rows.push({
            key: 'deviceId',
            label: t('activity.details.deviceId'),
            value: event.deviceId,
        });
    }
    if (event.metadata && typeof event.metadata === 'object') {
        const metadata = event.metadata as Record<string, unknown>;
        for (const [k, v] of Object.entries(metadata)) {
            if (v === null || v === undefined) continue;
            const display =
                typeof v === 'string'
                    ? v
                    : typeof v === 'number' || typeof v === 'boolean'
                      ? String(v)
                      : JSON.stringify(v);
            rows.push({ key: `meta-${k}`, label: k, value: display });
        }
    }

    return (
        <View
            style={[
                styles.detailsPanel,
                isLast && styles.detailsPanelLast,
                { backgroundColor: colors.card },
            ]}
            accessibilityLabel={t('a11y.activityDetails')}
        >
            {rows.map((row) => (
                <View key={row.key} style={styles.detailRow}>
                    <ThemedText
                        style={[
                            styles.detailLabel,
                            { color: colors.textSecondary },
                        ]}
                    >
                        {row.label}
                    </ThemedText>
                    <ThemedText
                        style={[styles.detailValue, { color: colors.text }]}
                        numberOfLines={3}
                    >
                        {row.value}
                    </ThemedText>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 20,
    },
    centeredState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        paddingHorizontal: 16,
        gap: 12,
    },
    centeredText: {
        fontSize: 15,
        opacity: 0.7,
    },
    emptyIcon: {
        opacity: 0.6,
    },
    emptyTitle: {
        fontSize: 17,
        fontWeight: Platform.OS === 'web' ? '600' : undefined,
        textAlign: 'center',
    },
    emptySubtitle: {
        fontSize: 14,
        textAlign: 'center',
        maxWidth: 320,
    },
    retryButton: {
        marginTop: 8,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 12,
    },
    retryButtonText: {
        fontSize: 15,
        fontWeight: '600',
    },
    loadMoreContainer: {
        alignItems: 'center',
        paddingVertical: 16,
    },
    loadMoreButton: {
        paddingHorizontal: 24,
        paddingVertical: 10,
        borderRadius: 24,
        borderWidth: 1,
    },
    loadMoreText: {
        fontSize: 14,
        fontWeight: '500',
    },
    outerFirst: {
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        overflow: 'hidden',
    },
    outerLast: {
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        gap: 12,
    },
    rowFirst: {},
    rowLast: {},
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    textContainer: {
        flex: 1,
    },
    rowTitle: {
        fontSize: 15,
        fontWeight: '400',
    },
    rowSubtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 60,
        opacity: 0.5,
    },
    detailsPanel: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 16,
        gap: 10,
    },
    detailsPanelLast: {},
    detailRow: {
        flexDirection: 'column',
        gap: 2,
    },
    detailLabel: {
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    detailValue: {
        fontSize: 14,
    },
});
