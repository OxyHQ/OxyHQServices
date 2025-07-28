import { OxyServices } from '../OxyServices';
import {
  FileMetadata,
  FileUploadResponse,
  FileListResponse,
  FileUpdateRequest,
  FileDeleteResponse
} from '../../models/interfaces';

/**
 * Default cloud URL for Oxy services, cloud is where the user files are. (e.g. images, videos, etc.). Not the API.
 */
export const OXY_CLOUD_URL = 'https://cloud.oxy.so';

/**
 * File service for handling file operations and management
 */
export class FileService extends OxyServices {
  /**
   * Upload a single file
   * Note: This method is deprecated. Use the new raw upload approach instead.
   */
  async uploadFile(
    file: File | Blob | any, // Use 'any' to handle Buffer type in cross-platform scenarios
    filename: string, 
    metadata?: Record<string, any>
  ): Promise<FileMetadata> {
    try {
      const formData = new FormData();
      formData.append('file', file, filename);
      
      if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
      }
      
      const res = await this.getClient().post('/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Upload multiple files
   * Note: This method is deprecated. Use the new raw upload approach instead.
   */
  async uploadFiles(
    files: (File | Blob | any)[], 
    filenames: string[], 
    metadata?: Record<string, any>
  ): Promise<FileUploadResponse> {
    try {
      const formData = new FormData();
      
      files.forEach((file, index) => {
        formData.append('files', file, filenames[index]);
      });
      
      if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
      }
      
      const res = await this.getClient().post('/files/upload-multiple', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(fileId: string): Promise<FileMetadata> {
    try {
      const res = await this.getClient().get(`/files/meta/${fileId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update file metadata
   */
  async updateFileMetadata(fileId: string, updates: FileUpdateRequest): Promise<FileMetadata> {
    try {
      const res = await this.getClient().put(`/files/meta/${fileId}`, updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete file
   */
  async deleteFile(fileId: string): Promise<FileDeleteResponse> {
    try {
      const res = await this.getClient().delete(`/files/${fileId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file download URL
   */
  getFileDownloadUrl(fileId: string): string {
    return `${OXY_CLOUD_URL}/files/${fileId}/download`;
  }

  /**
   * Get file stream URL
   */
  getFileStreamUrl(fileId: string): string {
    return `${OXY_CLOUD_URL}/files/${fileId}/stream`;
  }

  /**
   * List user files
   */
  async listUserFiles(
    userId: string,
    limit?: number,
    offset?: number,
    filters?: Record<string, any>
  ): Promise<FileListResponse> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          params.append(key, value.toString());
        });
      }
      
      const res = await this.getClient().get(`/files/list/${userId}?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Download file content
   */
  async downloadFileContent(fileId: string): Promise<Response> {
    try {
      const res = await this.getClient().get(`/files/${fileId}`, {
        responseType: 'blob'
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file content as text
   */
  async getFileContentAsText(fileId: string): Promise<string> {
    try {
      const res = await this.getClient().get(`/files/${fileId}`, {
        headers: {
          'Accept': 'text/plain'
        }
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file content as blob
   */
  async getFileContentAsBlob(fileId: string): Promise<Blob> {
    try {
      const res = await this.getClient().get(`/files/${fileId}`, {
        responseType: 'blob'
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 