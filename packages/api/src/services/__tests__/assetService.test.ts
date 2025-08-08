import { AssetService } from '../assetService';
import { S3Service } from '../s3Service';
import { File } from '../../models/File';

// Mock S3Service
jest.mock('../s3Service');
jest.mock('../../models/File');

const mockS3Service = {
  getPresignedUploadUrl: jest.fn(),
  fileExists: jest.fn(),
  deleteFile: jest.fn(),
  getPresignedDownloadUrl: jest.fn(),
} as unknown as S3Service;

const mockFile = {
  _id: 'test-file-id',
  sha256: 'test-sha256',
  size: 1024,
  mime: 'image/jpeg',
  ext: '.jpg',
  ownerUserId: 'test-user-id',
  status: 'active',
  storageKey: 'content/2025/01/te/test-sha256.jpg',
  links: [],
  variants: [],
  save: jest.fn(),
  originalName: 'test.jpg'
};

describe('AssetService', () => {
  let assetService: AssetService;

  beforeEach(() => {
    jest.clearAllMocks();
    assetService = new AssetService(mockS3Service);
  });

  describe('initUpload', () => {
    it('should create new file record and return upload URL for new file', async () => {
      const expectedSha256 = 'test-sha256';
      const expectedSize = 1024;
      const expectedMime = 'image/jpeg';
      const expectedUserId = 'test-user-id';

      // Mock File.findOne to return null (file doesn't exist)
      (File.findOne as jest.Mock).mockResolvedValue(null);

      // Mock File constructor and save
      const mockFileInstance = {
        ...mockFile,
        save: jest.fn().mockResolvedValue(mockFile)
      };
      (File as any as jest.Mock).mockImplementation(() => mockFileInstance);

      // Mock S3 service
      (mockS3Service.getPresignedUploadUrl as jest.Mock).mockResolvedValue('https://test-upload-url.com');

      const result = await assetService.initUpload(
        expectedUserId,
        expectedSha256,
        expectedSize,
        expectedMime
      );

      expect(result).toEqual({
        uploadUrl: 'https://test-upload-url.com',
        fileId: mockFile._id,
        sha256: expectedSha256
      });

      expect(File.findOne).toHaveBeenCalledWith({
        sha256: expectedSha256,
        status: { $ne: 'deleted' }
      });

      expect(mockFileInstance.save).toHaveBeenCalled();
      expect(mockS3Service.getPresignedUploadUrl).toHaveBeenCalled();
    });

    it('should return existing file info if file already exists', async () => {
      const expectedSha256 = 'existing-sha256';
      const expectedSize = 1024;
      const expectedMime = 'image/jpeg';
      const expectedUserId = 'test-user-id';

      // Mock File.findOne to return existing file
      (File.findOne as jest.Mock).mockResolvedValue(mockFile);

      // Mock S3 service
      (mockS3Service.getPresignedUploadUrl as jest.Mock).mockResolvedValue('https://test-upload-url.com');

      const result = await assetService.initUpload(
        expectedUserId,
        expectedSha256,
        expectedSize,
        expectedMime
      );

      expect(result).toEqual({
        uploadUrl: 'https://test-upload-url.com',
        fileId: mockFile._id,
        sha256: expectedSha256
      });

      expect(File.findOne).toHaveBeenCalledWith({
        sha256: expectedSha256,
        status: { $ne: 'deleted' }
      });

      // Should not create new file
      expect(File as any as jest.Mock).not.toHaveBeenCalled();
    });
  });

  describe('linkFile', () => {
    it('should add link to file', async () => {
      const fileId = 'test-file-id';
      const linkRequest = {
        app: 'mention',
        entityType: 'post',
        entityId: 'post-123',
        createdBy: 'user-123'
      };

      const fileWithEmptyLinks = {
        ...mockFile,
        links: [],
        save: jest.fn().mockResolvedValue({
          ...mockFile,
          links: [linkRequest]
        })
      };

      (File.findById as jest.Mock).mockResolvedValue(fileWithEmptyLinks);

      const result = await assetService.linkFile(fileId, linkRequest);

      expect(File.findById).toHaveBeenCalledWith(fileId);
      expect(fileWithEmptyLinks.links).toHaveLength(1);
      expect(fileWithEmptyLinks.links[0]).toMatchObject(linkRequest);
      expect(fileWithEmptyLinks.save).toHaveBeenCalled();
    });

    it('should not add duplicate link', async () => {
      const fileId = 'test-file-id';
      const linkRequest = {
        app: 'mention',
        entityType: 'post',
        entityId: 'post-123',
        createdBy: 'user-123'
      };

      const fileWithExistingLink = {
        ...mockFile,
        links: [linkRequest],
        save: jest.fn()
      };

      (File.findById as jest.Mock).mockResolvedValue(fileWithExistingLink);

      const result = await assetService.linkFile(fileId, linkRequest);

      expect(fileWithExistingLink.links).toHaveLength(1);
      expect(fileWithExistingLink.save).not.toHaveBeenCalled();
    });
  });

  describe('unlinkFile', () => {
    it('should remove link from file', async () => {
      const fileId = 'test-file-id';
      const linkToRemove = {
        app: 'mention',
        entityType: 'post',
        entityId: 'post-123',
        createdBy: 'user-123',
        createdAt: new Date()
      };

      const fileWithLink = {
        ...mockFile,
        links: [linkToRemove],
        save: jest.fn().mockResolvedValue({
          ...mockFile,
          links: [],
          status: 'trash'
        })
      };

      (File.findById as jest.Mock).mockResolvedValue(fileWithLink);

      const result = await assetService.unlinkFile(
        fileId,
        linkToRemove.app,
        linkToRemove.entityType,
        linkToRemove.entityId
      );

      expect(File.findById).toHaveBeenCalledWith(fileId);
      expect(fileWithLink.links).toHaveLength(0);
      expect(fileWithLink.status).toBe('trash');
      expect(fileWithLink.save).toHaveBeenCalled();
    });
  });

  describe('getFileUrl', () => {
    it('should return presigned URL for file', async () => {
      const fileId = 'test-file-id';
      const expectedUrl = 'https://test-download-url.com';

      (File.findById as jest.Mock).mockResolvedValue(mockFile);
      (mockS3Service.getPresignedDownloadUrl as jest.Mock).mockResolvedValue(expectedUrl);

      const result = await assetService.getFileUrl(fileId);

      expect(File.findById).toHaveBeenCalledWith(fileId);
      expect(mockS3Service.getPresignedDownloadUrl).toHaveBeenCalledWith(
        mockFile.storageKey,
        3600
      );
      expect(result).toBe(expectedUrl);
    });

    it('should return variant URL when variant requested', async () => {
      const fileId = 'test-file-id';
      const variantType = 'w320';
      const variantKey = 'variants/2025/01/te/test-sha256/w320.webp';
      const expectedUrl = 'https://test-variant-url.com';

      const fileWithVariant = {
        ...mockFile,
        variants: [
          {
            type: variantType,
            key: variantKey,
            width: 320,
            height: 240,
            readyAt: new Date()
          }
        ]
      };

      (File.findById as jest.Mock).mockResolvedValue(fileWithVariant);
      (mockS3Service.getPresignedDownloadUrl as jest.Mock).mockResolvedValue(expectedUrl);

      const result = await assetService.getFileUrl(fileId, variantType);

      expect(mockS3Service.getPresignedDownloadUrl).toHaveBeenCalledWith(
        variantKey,
        3600
      );
      expect(result).toBe(expectedUrl);
    });
  });

  describe('calculateSHA256', () => {
    it('should calculate SHA256 hash correctly', () => {
      const testData = Buffer.from('hello world');
      const expectedHash = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

      const result = AssetService.calculateSHA256(testData);

      expect(result).toBe(expectedHash);
    });
  });
});