# Integration Examples

This directory contains examples of how to integrate the new @oxyhq/services Redux architecture in different scenarios.

## Examples

### 1. Basic Integration (`basic-integration.tsx`)
Shows the simplest way to integrate Oxy services with setupOxyStore.

### 2. Tree-Shaking (`tree-shaking.tsx`)
Demonstrates how to include only specific features using setupOxyStore.pick().

### 3. Custom App Integration (`custom-app-integration.tsx`)
Shows how to integrate with an existing app that has its own Redux store.

### 4. External Store Management (`external-store.tsx`)
Example of managing the Redux store externally and using skipReduxProvider.

### 5. Migration Example (`migration-example.tsx`)
Before and after comparison showing how to migrate from the old architecture.

## Usage

Each example is self-contained and can be used as a reference for your specific use case. Copy the relevant parts into your application and modify as needed.