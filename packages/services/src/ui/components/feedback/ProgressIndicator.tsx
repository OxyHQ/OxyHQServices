import React from 'react';
import { View } from 'react-native';
import type { FeedbackColors } from './types';

interface ProgressIndicatorProps {
    currentStep: number;
    totalSteps: number;
    colors: FeedbackColors;
    styles: any;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = React.memo(({
    currentStep,
    totalSteps,
    colors,
    styles,
}) => (
    <View style={styles.progressContainer} accessibilityRole="progressbar" accessibilityLabel={`Step ${currentStep + 1} of ${totalSteps}`}>
        {Array.from({ length: totalSteps }, (_, index) => (
            <View
                key={index}
                style={[
                    styles.progressDot,
                    currentStep === index ?
                        { backgroundColor: colors.primary, width: 24 } :
                        { backgroundColor: colors.border }
                ]}
            />
        ))}
    </View>
));

ProgressIndicator.displayName = 'ProgressIndicator';

export default ProgressIndicator;
