import type React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Dialog, type DialogControlProps } from '@oxyhq/bloom';
import { useTheme } from '@oxyhq/bloom/theme';
import type { FileMetadata } from '@oxyhq/core';
import { formatFileSize, getFileIcon } from '../../utils/fileManagement';

interface FileDetailsModalProps {
    control: DialogControlProps;
    file: FileMetadata | null;
    onDownload: (fileId: string, filename: string) => void;
    onDelete: (fileId: string, filename: string) => void;
    isOwner: boolean;
    onClose?: () => void;
}

export const FileDetailsModal: React.FC<FileDetailsModalProps> = ({
    control,
    file,
    onDownload,
    onDelete,
    isOwner,
    onClose,
}) => {
    const { colors } = useTheme();

    if (!file) return null;

    const actions = isOwner
        ? [
              {
                  label: 'Download',
                  onPress: () => onDownload(file.id, file.filename),
              },
              {
                  label: 'Delete',
                  color: 'destructive' as const,
                  onPress: () => onDelete(file.id, file.filename),
              },
              { label: 'Cancel', color: 'cancel' as const },
          ]
        : [
              {
                  label: 'Download',
                  onPress: () => onDownload(file.id, file.filename),
              },
              { label: 'Cancel', color: 'cancel' as const },
          ];

    return (
        <Dialog
            control={control}
            onClose={onClose}
            label="File Details"
            actions={actions}
        >
            <View className="bg-secondary border-border p-[18px] rounded-[14px] border items-center">
                <View className="mb-space-16">
                    <Ionicons
                        name={getFileIcon(file.contentType)}
                        size={64}
                        color={colors.primary}
                    />
                </View>

                <Text className="text-text text-[20px] font-bold text-center mb-space-24">
                    {file.filename}
                </Text>

                <View className="w-full mb-space-32">
                    <View className="flex-row justify-between items-start mb-space-12 flex-wrap">
                        <Text className="text-text-secondary text-[16px] font-medium flex-1 min-w-[100px]">
                            Size:
                        </Text>
                        <Text className="text-text text-[16px] flex-[2] text-right">
                            {formatFileSize(file.length)}
                        </Text>
                    </View>

                    <View className="flex-row justify-between items-start mb-space-12 flex-wrap">
                        <Text className="text-text-secondary text-[16px] font-medium flex-1 min-w-[100px]">
                            Type:
                        </Text>
                        <Text className="text-text text-[16px] flex-[2] text-right">
                            {file.contentType}
                        </Text>
                    </View>

                    <View className="flex-row justify-between items-start mb-space-12 flex-wrap">
                        <Text className="text-text-secondary text-[16px] font-medium flex-1 min-w-[100px]">
                            Uploaded:
                        </Text>
                        <Text className="text-text text-[16px] flex-[2] text-right">
                            {new Date(file.uploadDate).toLocaleString()}
                        </Text>
                    </View>

                    {file.metadata?.description && (
                        <View className="flex-row justify-between items-start mb-space-12 flex-wrap">
                            <Text className="text-text-secondary text-[16px] font-medium flex-1 min-w-[100px]">
                                Description:
                            </Text>
                            <Text className="text-text text-[16px] flex-[2] text-right">
                                {file.metadata.description}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </Dialog>
    );
};
