import React, { useState } from 'react';
import { 
  View, 
  Text, 
  Button, 
  StyleSheet, 
  SafeAreaView, 
  Platform,
  Image,
  ActivityIndicator,
  FlatList
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { OxyServices } from '@oxyhq/services';

// Initialize the OxyServices client
const oxyServices = new OxyServices({
  baseURL: 'https://api.example.com' // Replace with your API URL
});

export default function FileUploadExample() {
  const [files, setFiles] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(false);
  const [userId] = useState('user123'); // Replace with actual user ID or get from context

  // Request permissions (for mobile)
  const requestPermissions = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alert('Sorry, we need camera roll permissions to make this work!');
        return false;
      }
      return true;
    }
    return true;
  };

  // Pick an image from gallery
  const pickImage = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      setLoading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        await uploadFile(asset.uri, asset.fileName || 'image.jpg');
      }
    } catch (error) {
      console.error('Error picking image:', error);
      alert('Failed to pick image');
    } finally {
      setLoading(false);
    }
  };

  // Pick a document
  const pickDocument = async () => {
    try {
      setLoading(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*', // All file types
        copyToCacheDirectory: true,
      });

      if (result.type === 'success') {
        await uploadFile(result.uri, result.name);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      alert('Failed to pick document');
    } finally {
      setLoading(false);
    }
  };

  // Upload file to server
  const uploadFile = async (uri: string, filename: string) => {
    try {
      // For web
      let file;
      if (Platform.OS === 'web') {
        // Fetch the file as blob for web
        const response = await fetch(uri);
        file = await response.blob();
      } else {
        // For React Native, we need to create a form-compatible blob
        const response = await fetch(uri);
        file = await response.blob();
      }

      const metadata = {
        userId,
        description: `Uploaded on ${new Date().toLocaleDateString()}`,
        tags: ['example', 'upload']
      };

      const result = await oxyServices.uploadFile(file, filename, metadata);
      console.log('Upload successful:', result);
      
      // Refresh file list
      loadUserFiles();
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to upload file');
    }
  };

  // Load user files
  const loadUserFiles = async () => {
    try {
      setLoading(true);
      const result = await oxyServices.listUserFiles(userId);
      setFiles(result.files);
    } catch (error) {
      console.error('Error loading files:', error);
      alert('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  // Delete a file
  const deleteFile = async (fileId: string) => {
    try {
      setLoading(true);
      await oxyServices.deleteFile(fileId);
      // Refresh file list after deletion
      loadUserFiles();
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Failed to delete file');
    } finally {
      setLoading(false);
    }
  };

  // Load files when component mounts
  React.useEffect(() => {
    loadUserFiles();
  }, []);

  // Render file item
  const renderFileItem = ({ item }: { item: any }) => {
    const isImage = item.contentType.startsWith('image/');
    const fileUrl = oxyServices.getFileDownloadUrl(item.id);
    
    return (
      <View style={styles.fileItem}>
        {isImage ? (
          <Image source={{ uri: fileUrl }} style={styles.thumbnail} />
        ) : (
          <View style={styles.documentIcon}>
            <Text style={styles.documentIconText}>
              {item.filename.split('.').pop()?.toUpperCase() || 'FILE'}
            </Text>
          </View>
        )}
        
        <View style={styles.fileInfo}>
          <Text style={styles.fileName}>{item.filename}</Text>
          <Text style={styles.fileDetails}>
            {(item.length / 1024).toFixed(2)} KB • {new Date(item.uploadDate).toLocaleDateString()}
          </Text>
        </View>
        
        <View style={styles.fileActions}>
          <Button
            title="Open"
            onPress={() => {
              if (Platform.OS === 'web') {
                window.open(fileUrl, '_blank');
              } else {
                // On mobile, you'd use Linking or a WebView
                alert('Opening file: ' + fileUrl);
              }
            }}
          />
          <Button
            title="Delete"
            color="red"
            onPress={() => deleteFile(item.id)}
          />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>File Management Example</Text>
      
      <View style={styles.buttonContainer}>
        <Button title="Pick Image" onPress={pickImage} disabled={loading} />
        <View style={styles.buttonSpacer} />
        <Button title="Pick Document" onPress={pickDocument} disabled={loading} />
        <View style={styles.buttonSpacer} />
        <Button title="Refresh" onPress={loadUserFiles} disabled={loading} />
      </View>
      
      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" style={styles.loader} />
      ) : (
        <>
          <Text style={styles.sectionHeader}>Your Files ({files.length})</Text>
          {files.length === 0 ? (
            <Text style={styles.emptyText}>No files uploaded yet.</Text>
          ) : (
            <FlatList
              data={files}
              keyExtractor={item => item.id}
              renderItem={renderFileItem}
              style={styles.fileList}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  buttonSpacer: {
    width: 10,
  },
  loader: {
    marginTop: 50,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  fileList: {
    flex: 1,
  },
  fileItem: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    alignItems: 'center',
  },
  thumbnail: {
    width: 50,
    height: 50,
    borderRadius: 4,
    marginRight: 12,
  },
  documentIcon: {
    width: 50,
    height: 50,
    borderRadius: 4,
    backgroundColor: '#e1e1e1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  documentIconText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  fileDetails: {
    fontSize: 12,
    color: '#666',
  },
  fileActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 40,
    fontSize: 16,
  }
});