import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { Chip } from '@oxyhq/bloom/chip';
import { useTheme } from '@oxyhq/bloom/theme';
import type { ReputationRule, ReputationCategory } from '@oxyhq/core';
import type { BaseScreenProps } from '../../types/navigation';
import Header from '../../components/Header';
import LoadingState from '../../components/LoadingState';
import { useI18n } from '../../hooks/useI18n';
import { useOxy } from '../../context/OxyContext';

/** Stable display order for rule category sections. */
const CATEGORY_ORDER: ReputationCategory[] = [
    'content',
    'social',
    'trust',
    'moderation',
    'physical',
    'penalty',
    'other',
];

const TrustRulesScreen: React.FC<BaseScreenProps> = ({ goBack }) => {
    const { oxyServices } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();

    const [rules, setRules] = useState<ReputationRule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        oxyServices.getReputationRules()
            .then((data) => setRules(Array.isArray(data) ? data : []))
            .catch((err: unknown) => setError((err instanceof Error ? err.message : null) || 'Failed to load rules'))
            .finally(() => setIsLoading(false));
    }, [oxyServices]);

    // Group rules by category, preserving a stable section order. Categories
    // with no rules are dropped; unknown categories fall back to "other".
    const groupedRules = useMemo(() => {
        const buckets = new Map<ReputationCategory, ReputationRule[]>();
        for (const rule of rules) {
            const category: ReputationCategory = CATEGORY_ORDER.includes(rule.category)
                ? rule.category
                : 'other';
            const bucket = buckets.get(category);
            if (bucket) {
                bucket.push(rule);
            } else {
                buckets.set(category, [rule]);
            }
        }
        return CATEGORY_ORDER
            .filter((category) => buckets.has(category))
            .map((category) => ({ category, items: buckets.get(category) ?? [] }));
    }, [rules]);

    return (
        <View className="flex-1 bg-bg">
            <Header
                title={t('trust.rules.title') || 'Trust Rules'}
                subtitle={t('trust.rules.subtitle') || 'How to earn reputation'}
                onBack={goBack}
                elevation="subtle"
            />
            {isLoading ? (
                <LoadingState color={bloomTheme.colors.primary} />
            ) : error ? (
                <Text className="text-text-secondary text-base text-center px-screen-margin pt-space-40">
                    {error}
                </Text>
            ) : rules.length === 0 ? (
                <Text className="text-text-secondary text-base text-center px-screen-margin pt-space-40">
                    {t('trust.rules.empty') || 'No rules found.'}
                </Text>
            ) : (
                <ScrollView className="flex-1">
                    <View className="px-screen-margin pb-space-24 pt-space-12">
                        {groupedRules.map(({ category, items }) => (
                            <SettingsListGroup
                                key={category}
                                title={t(`trust.rules.categories.${category}`) || category}
                            >
                                {items.map((rule) => (
                                    <SettingsListItem
                                        key={rule.id}
                                        title={rule.description}
                                        showChevron={false}
                                        rightElement={
                                            <Chip
                                                variant="soft"
                                                size="small"
                                                color={rule.points > 0 ? 'success' : rule.points < 0 ? 'error' : 'default'}
                                            >
                                                {rule.points > 0 ? `+${rule.points}` : `${rule.points}`}
                                            </Chip>
                                        }
                                        accessibilityLabel={`${rule.description}, ${rule.points > 0 ? '+' : ''}${rule.points} ${t('trust.center.balance') || 'reputation points'}`}
                                    />
                                ))}
                            </SettingsListGroup>
                        ))}
                    </View>
                </ScrollView>
            )}
        </View>
    );
};

export default TrustRulesScreen;
