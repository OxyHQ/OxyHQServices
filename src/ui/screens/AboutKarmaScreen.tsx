import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    Platform,
    Image,
    TextStyle,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { fontFamilies } from '../styles/fonts';

const AboutKarmaScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
}) => {


    return (
        <View style={[styles.container]}>
            <Text style={[styles.message]}>About Karma</Text>
            <Text style={[styles.message]}>
                Karma is a system that rewards users for their contributions to the community.
                The more you contribute, the more karma points you earn!
            </Text>
            <Text style={[styles.message]}>
                Your karma points can be used to unlock special features and benefits within the app.
            </Text>
            <Text style={[styles.message]}>
                Thank you for being a part of our community!
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    message: {
        fontSize: 20,
        fontFamily: fontFamilies.phuduBold,
        textAlign: 'center',
        marginTop: 20,
    },
});

export default AboutKarmaScreen;
