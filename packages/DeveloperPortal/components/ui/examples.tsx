/**
 * UI Components Usage Examples
 * 
 * This file demonstrates how to use the reusable UI components
 * from the @/components/ui folder.
 */

import React from 'react';
import { View, ScrollView } from 'react-native';
import {
    Button,
    IconButton,
    Card,
    Input,
    Badge,
    Loading,
    EmptyState,
    InfoRow,
    Divider,
} from '@/components';

export function ComponentShowcase() {
    return (
        <ScrollView style={{ padding: 16 }}>
            {/* Buttons */}
            <Card>
                <Button
                    title="Primary Button"
                    onPress={() => console.log('Pressed')}
                    variant="primary"
                    icon="checkmark-circle"
                />
                
                <Button
                    title="Danger Button"
                    onPress={() => console.log('Pressed')}
                    variant="danger"
                    icon="trash-outline"
                    style={{ marginTop: 8 }}
                />

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <IconButton icon="heart" onPress={() => {}} variant="primary" />
                    <IconButton icon="star" onPress={() => {}} variant="warning" />
                    <IconButton icon="trash" onPress={() => {}} variant="danger" />
                </View>
            </Card>

            <Divider />

            {/* Inputs */}
            <Input
                label="Email Address"
                value=""
                onChangeText={() => {}}
                placeholder="you@example.com"
                keyboardType="email-address"
                helperText="We'll never share your email"
            />

            <Input
                label="Password"
                value=""
                onChangeText={() => {}}
                placeholder="Enter password"
                secureTextEntry
                error="Password must be at least 8 characters"
            />

            <Divider />

            {/* Badges */}
            <Card>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Badge label="Active" variant="success" />
                    <Badge label="Pending" variant="warning" />
                    <Badge label="Error" variant="danger" />
                    <Badge label="Info" variant="info" />
                    <Badge label="Default" variant="primary" />
                </View>
            </Card>

            <Divider />

            {/* Info Rows */}
            <Card>
                <InfoRow
                    icon="key-outline"
                    label="API Key"
                    value="oxy_dk_abc123..."
                    onPress={() => console.log('Copy API Key')}
                />
                <InfoRow
                    icon="globe-outline"
                    label="Webhook URL"
                    value="https://api.example.com/webhook"
                />
                <InfoRow
                    icon="calendar-outline"
                    label="Created"
                    value="Nov 8, 2025"
                />
            </Card>

            <Divider />

            {/* Loading States */}
            <Card>
                <Loading message="Loading data..." size="small" />
            </Card>

            <Divider />

            {/* Empty State */}
            <EmptyState
                icon="folder-open-outline"
                title="No Items Found"
                message="Get started by creating your first item"
                action={
                    <Button
                        title="Create Item"
                        onPress={() => console.log('Create')}
                        icon="add"
                    />
                }
            />
        </ScrollView>
    );
}

/**
 * Individual Component Examples
 */

// Button Examples
export const ButtonExamples = () => (
    <>
        {/* Primary with icon */}
        <Button title="Save Changes" onPress={() => {}} icon="save" />
        
        {/* Loading state */}
        <Button title="Loading..." onPress={() => {}} loading />
        
        {/* Disabled */}
        <Button title="Disabled" onPress={() => {}} disabled />
        
        {/* Full width */}
        <Button title="Sign In" onPress={() => {}} fullWidth />
        
        {/* Different variants */}
        <Button title="Delete" onPress={() => {}} variant="danger" />
        <Button title="Cancel" onPress={() => {}} variant="ghost" />
    </>
);

// Card Examples
export const CardExamples = () => (
    <>
        {/* Default card */}
        <Card>
            <View>Content here</View>
        </Card>
        
        {/* Elevated card */}
        <Card variant="elevated">
            <View>Important content</View>
        </Card>
        
        {/* Interactive card */}
        <Card onPress={() => console.log('Tapped')}>
            <View>Tap me!</View>
        </Card>
    </>
);

// Input Examples
export const InputExamples = () => (
    <>
        {/* Basic input */}
        <Input
            label="Name"
            value=""
            onChangeText={() => {}}
            placeholder="John Doe"
        />
        
        {/* With validation */}
        <Input
            label="Email"
            value="invalid-email"
            onChangeText={() => {}}
            error="Please enter a valid email"
        />
        
        {/* Multiline */}
        <Input
            label="Description"
            value=""
            onChangeText={() => {}}
            multiline
            numberOfLines={4}
        />
        
        {/* URL input */}
        <Input
            label="Website"
            value=""
            onChangeText={() => {}}
            keyboardType="url"
            autoCapitalize="none"
            helperText="Enter your website URL"
        />
    </>
);
