import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
    resultItem: {
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    selectedResult: {
        backgroundColor: '#f0f0f0',
    },
    resultText: {
        fontSize: 16,
    },
});

const SearchResult = React.memo(({
    result,
    onSelect,
    isSelected
}: {
    result: any;
    onSelect: (result: any) => void;
    isSelected: boolean;
}) => (
    <TouchableOpacity
        style={[
            styles.resultItem,
            isSelected && styles.selectedResult
        ]}
        onPress={() => onSelect(result)}
    >
        <Text style={styles.resultText}>{result.display_name}</Text>
    </TouchableOpacity>
));

export default SearchResult; 