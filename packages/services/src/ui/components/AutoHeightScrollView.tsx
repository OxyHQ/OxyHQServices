import React, { useState, forwardRef } from 'react';
import { ScrollView, type ScrollViewProps, StyleSheet, type ViewStyle } from 'react-native';

export type AutoHeightScrollViewProps = ScrollViewProps & {
    /**
     * Optional style override.
     * Note: height and flexShrink are managed internally but can be overridden if absolutely necessary.
     */
    style?: ViewStyle;
};

/**
 * A ScrollView that automatically adjusts its height to match its content,
 * but shrinks if constrained by a parent (e.g., a Max Height Bottom Sheet).
 * 
 * This solves the "collapsed to 0 height" issue when using ScrollView inside an auto-height container.
 */
export const AutoHeightScrollView = forwardRef<ScrollView, AutoHeightScrollViewProps>((props, ref) => {
    const [contentHeight, setContentHeight] = useState(0);

    const { style, onContentSizeChange, ...rest } = props;

    const handleContentSizeChange = (w: number, h: number) => {
        setContentHeight(h);
        onContentSizeChange?.(w, h);
    };

    return (
        <ScrollView
            ref={ref}
            style={[
                styles.defaultStyle,
                style,
                { height: contentHeight > 0 ? contentHeight : undefined }
            ]}
            onContentSizeChange={handleContentSizeChange}
            {...rest}
        />
    );
});

const styles = StyleSheet.create({
    defaultStyle: {
        flexShrink: 1,
        flexGrow: 0, // Ensure we don't force expansion beyond content unless needed
        minHeight: 0,
    }
});

AutoHeightScrollView.displayName = 'AutoHeightScrollView';
