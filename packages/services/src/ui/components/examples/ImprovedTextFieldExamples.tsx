import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TextField from '../internal/TextField';

const ImprovedTextFieldExamples: React.FC = () => {
    const [formData, setFormData] = useState({
        basic: '',
        withIcon: '',
        withError: '',
        withSuccess: '',
        password: '',
        phone: '',
        creditCard: '',
        currency: '',
        email: '',
        bio: '',
        username: '',
        disabled: 'This field is disabled',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [success, setSuccess] = useState<Record<string, boolean>>({});

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));

        // Clear errors when user starts typing
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const validateField = (field: string, value: string) => {
        switch (field) {
            case 'email':
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (value && !emailRegex.test(value)) {
                    setErrors(prev => ({ ...prev, [field]: 'Please enter a valid email address' }));
                    setSuccess(prev => ({ ...prev, [field]: false }));
                } else if (value && emailRegex.test(value)) {
                    setErrors(prev => ({ ...prev, [field]: '' }));
                    setSuccess(prev => ({ ...prev, [field]: true }));
                }
                break;
            case 'password':
                if (value && value.length < 8) {
                    setErrors(prev => ({ ...prev, [field]: 'Password must be at least 8 characters' }));
                } else if (value && value.length >= 8) {
                    setErrors(prev => ({ ...prev, [field]: '' }));
                    setSuccess(prev => ({ ...prev, [field]: true }));
                }
                break;
        }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.title}>Improved TextField Examples</Text>

            {/* Basic TextField */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Basic TextField</Text>
                <TextField
                    label="Basic Input"
                    placeholder="Enter some text"
                    value={formData.basic}
                    onChangeText={(value) => handleChange('basic', value)}
                />
            </View>

            {/* TextField with Leading Icon */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>With Leading Icon</Text>
                <TextField
                    label="Email Address"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChangeText={(value) => handleChange('email', value)}
                    onBlur={() => validateField('email', formData.email)}
                    error={errors.email}
                    success={success.email}
                    leading={({ color, size }) => (
                        <Ionicons name="mail" size={size} color={color} />
                    )}
                    autoComplete="email"
                    keyboardType="email-address"
                />
            </View>

            {/* TextField with Trailing Icon */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>With Trailing Icon</Text>
                <TextField
                    label="Search"
                    placeholder="Search for something..."
                    value={formData.withIcon}
                    onChangeText={(value) => handleChange('withIcon', value)}
                    trailing={({ color, size }) => (
                        <Ionicons name="search" size={size} color={color} />
                    )}
                />
            </View>

            {/* Password TextField */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Password with Strength</Text>
                <TextField
                    label="Password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChangeText={(value) => handleChange('password', value)}
                    onBlur={() => validateField('password', formData.password)}
                    error={errors.password}
                    success={success.password}
                    secureTextEntry
                    passwordStrength
                    leading={({ color, size }) => (
                        <Ionicons name="lock-closed" size={size} color={color} />
                    )}
                />
            </View>

            {/* Input Masking Examples */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Input Masking</Text>

                <TextField
                    label="Phone Number"
                    placeholder="(555) 123-4567"
                    value={formData.phone}
                    onChangeText={(value) => handleChange('phone', value)}
                    inputMask="phone"
                    keyboardType="phone-pad"
                    leading={({ color, size }) => (
                        <Ionicons name="call" size={size} color={color} />
                    )}
                />

                <TextField
                    label="Credit Card"
                    placeholder="1234 5678 9012 3456"
                    value={formData.creditCard}
                    onChangeText={(value) => handleChange('creditCard', value)}
                    inputMask="creditCard"
                    keyboardType="numeric"
                    leading={({ color, size }) => (
                        <Ionicons name="card" size={size} color={color} />
                    )}
                />

                <TextField
                    label="Amount"
                    placeholder="$0.00"
                    value={formData.currency}
                    onChangeText={(value) => handleChange('currency', value)}
                    inputMask="currency"
                    keyboardType="decimal-pad"
                    leading={({ color, size }) => (
                        <Ionicons name="cash" size={size} color={color} />
                    )}
                />
            </View>

            {/* Variants */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Variants</Text>

                <TextField
                    label="Filled Variant"
                    placeholder="This is filled variant"
                    value={formData.username}
                    onChangeText={(value) => handleChange('username', value)}
                    variant="filled"
                    color="primary"
                />

                <TextField
                    label="Outlined Variant"
                    placeholder="This is outlined variant"
                    value={formData.bio}
                    onChangeText={(value) => handleChange('bio', value)}
                    variant="outlined"
                    color="secondary"
                    multiline
                    numberOfLines={3}
                />

                <TextField
                    label="Standard Variant"
                    placeholder="This is standard variant"
                    value={formData.withSuccess}
                    onChangeText={(value) => handleChange('withSuccess', value)}
                    variant="standard"
                    color="success"
                />
            </View>

            {/* Colors */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Color Variants</Text>

                <TextField
                    label="Primary Color"
                    placeholder="Primary color input"
                    value={formData.basic}
                    onChangeText={(value) => handleChange('basic', value)}
                    color="primary"
                />

                <TextField
                    label="Secondary Color"
                    placeholder="Secondary color input"
                    value={formData.basic}
                    onChangeText={(value) => handleChange('basic', value)}
                    color="secondary"
                />

                <TextField
                    label="Error Color"
                    placeholder="Error color input"
                    value={formData.withError}
                    onChangeText={(value) => handleChange('withError', value)}
                    color="error"
                    error="This is an error message"
                />

                <TextField
                    label="Success Color"
                    placeholder="Success color input"
                    value={formData.withSuccess}
                    onChangeText={(value) => handleChange('withSuccess', value)}
                    color="success"
                    success
                />

                <TextField
                    label="Warning Color"
                    placeholder="Warning color input"
                    value={formData.basic}
                    onChangeText={(value) => handleChange('basic', value)}
                    color="warning"
                />
            </View>

            {/* Enhanced Features */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Enhanced Features</Text>

                <TextField
                    label="With Character Count"
                    placeholder="Type something..."
                    value={formData.bio}
                    onChangeText={(value) => handleChange('bio', value)}
                    maxLength={100}
                    showCharacterCount
                    multiline
                    numberOfLines={3}
                />

                <TextField
                    label="Clearable Input"
                    placeholder="Type and clear me"
                    value={formData.basic}
                    onChangeText={(value) => handleChange('basic', value)}
                    clearable
                />

                <TextField
                    label="With Helper Text"
                    placeholder="Helper text example"
                    value={formData.basic}
                    onChangeText={(value) => handleChange('basic', value)}
                    helperText="This is helper text that provides additional information"
                />

                <TextField
                    label="Disabled Input"
                    value={formData.disabled}
                    disabled
                    helperText="This input is disabled"
                />
            </View>

            {/* Custom Styling */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Custom Styling</Text>

                <TextField
                    label="Custom Styled"
                    placeholder="Custom styling example"
                    value={formData.basic}
                    onChangeText={(value) => handleChange('basic', value)}
                    style={{ marginBottom: 16 }}
                    inputContainerStyle={{
                        backgroundColor: '#f0f8ff',
                        borderColor: '#4169e1',
                    }}
                    inputStyle={{
                        color: '#4169e1',
                        fontWeight: '600',
                    }}
                    leading={({ color, size }) => (
                        <Ionicons name="star" size={size} color="#4169e1" />
                    )}
                />
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    content: {
        padding: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
        color: '#333',
    },
    section: {
        marginBottom: 30,
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 3.84,
        elevation: 5,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 16,
        color: '#333',
    },
});

export default ImprovedTextFieldExamples; 