import { File, IFile, IFileVariant } from '../models/File';
import { S3Service } from './s3Service';
import { logger } from '../utils/logger';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { VariantConfig, VariantCommitRetryOptions } from '../types/variant.types';

// FFprobe metadata interfaces for type safety
interface FFprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

interface FFprobeFormat {
  duration?: string;
  bit_rate?: string;
}

interface FFprobeMetadata {
  streams?: FFprobeStream[];
  format?: FFprobeFormat;
}

// Get FFmpeg and FFprobe paths - use static binaries if available, otherwise fallback to system
function getFfmpegPath(): string {
  try {
    // ffmpeg-static exports the path as a string directly
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    logger.debug('[VariantService] ffmpeg-static require result', { type: typeof ffmpegStatic, value: ffmpegStatic });
    
    if (ffmpegStatic && typeof ffmpegStatic === 'string') {
      const binaryPath = ffmpegStatic;
      logger.debug('[VariantService] Checking ffmpeg path', { binaryPath });
      
      // Verify the path exists and is a file
      if (fs.existsSync(binaryPath)) {
        const stats = fs.statSync(binaryPath);
        if (stats.isFile()) {
          // Make executable if not already (needed for some platforms)
          try {
            fs.chmodSync(binaryPath, 0o755);
          } catch {
            // Ignore chmod errors
          }
          logger.info('[VariantService] Using ffmpeg-static binary', { binaryPath });
          return binaryPath;
        } else {
          logger.warn('[VariantService] ffmpeg-static path is not a file', { binaryPath });
        }
      } else {
        logger.warn('[VariantService] ffmpeg-static path does not exist', { binaryPath });
      }
    } else {
      logger.warn('[VariantService] ffmpeg-static did not return a string', { type: typeof ffmpegStatic, value: ffmpegStatic });
    }
  } catch (e) {
    const error = e as Error;
    logger.error('[VariantService] Error loading ffmpeg-static', { message: error.message, stack: error.stack });
  }
  
  // Fallback to system ffmpeg
  logger.warn('[VariantService] Falling back to system ffmpeg (may not be installed)');
  return 'ffmpeg';
}

function getFfprobePath(): string {
  try {
    // ffprobe-static exports an object with a path property
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffprobeStatic = require('ffprobe-static');
    logger.debug('[VariantService] ffprobe-static require result', { type: typeof ffprobeStatic, value: ffprobeStatic });
    
    if (ffprobeStatic) {
      const binaryPath = typeof ffprobeStatic === 'string' 
        ? ffprobeStatic 
        : (ffprobeStatic.path || ffprobeStatic.default);
      
      if (binaryPath) {
        logger.debug('[VariantService] Checking ffprobe path', { binaryPath });
        
        // Verify the path exists and is a file
        if (fs.existsSync(binaryPath)) {
          const stats = fs.statSync(binaryPath);
          if (stats.isFile()) {
            // Make executable if not already (needed for some platforms)
            try {
              fs.chmodSync(binaryPath, 0o755);
            } catch {
              // Ignore chmod errors
            }
            logger.info('[VariantService] Using ffprobe-static binary', { binaryPath });
            return binaryPath;
          } else {
            logger.warn('[VariantService] ffprobe-static path is not a file', { binaryPath });
          }
        } else {
          logger.warn('[VariantService] ffprobe-static path does not exist', { binaryPath });
          // Check if this is an unsupported architecture issue
          const arch = os.arch();
          const platform = os.platform();
          if (platform === 'linux' && arch === 'arm64') {
            logger.warn('[VariantService] ffprobe-static does not provide ARM64 Linux binaries', { arch, platform });
          }
        }
      } else {
        logger.warn('[VariantService] ffprobe-static did not provide a path');
      }
    }
  } catch (e) {
    const error = e as Error;
    logger.error('[VariantService] Error loading ffprobe-static', { message: error.message, stack: error.stack });
  }
  
  // Fallback to system ffprobe - verify it exists first
  const systemFfprobe = 'ffprobe';
  try {
    // Try to check if system ffprobe is available by checking PATH
    execSync('which ffprobe', { stdio: 'ignore' });
    logger.info('[VariantService] Using system ffprobe');
    return systemFfprobe;
  } catch (e) {
    logger.warn('[VariantService] System ffprobe not found in PATH - video metadata extraction may fail. Install with: sudo apt-get install ffmpeg');
    // Still return 'ffprobe' as fallback - spawn will handle the error gracefully
    return systemFfprobe;
  }
}

const ffmpegPath = getFfmpegPath();
const ffprobePath = getFfprobePath();

// Log resolved paths at module load
logger.info('[VariantService] Resolved FFmpeg path', { ffmpegPath });
logger.info('[VariantService] Resolved FFprobe path', { ffprobePath });

// Log final paths being used
try {
  logger.info('FFmpeg/FFprobe paths initialized', {
    ffmpegPath,
    ffprobePath,
    ffmpegExists: fs.existsSync(ffmpegPath),
    ffprobeExists: fs.existsSync(ffprobePath)
  });
} catch {
  // Logger might not be initialized yet, ignore
}

// Note: exec import kept for potential future use with execAsync
// Currently using spawn() for all FFmpeg operations

export interface VariantConfigWithType extends VariantConfig {
  type: string;
}

export interface VideoVariantConfig {
  type: string;
  width?: number;
  height?: number;
  bitrate?: string; // e.g., '500k', '1M', '2M'
  videoCodec?: string;
  audioCodec?: string;
  preset?: string; // FFmpeg preset (ultrafast, fast, medium, slow)
}

export class VariantService {
  private readonly imageVariants: VariantConfigWithType[] = [
    { type: 'thumb', width: 256, height: 256, quality: 82, format: 'webp' },
    { type: 'w320', width: 320, quality: 82, format: 'webp' },
    { type: 'w640', width: 640, quality: 82, format: 'webp' },
    { type: 'w1280', width: 1280, quality: 82, format: 'webp' },
    { type: 'w2048', width: 2048, quality: 82, format: 'webp' }
  ];

  private readonly videoVariants: VideoVariantConfig[] = [
    { type: '360p', width: 640, height: 360, bitrate: '500k', videoCodec: 'libx264', audioCodec: 'aac', preset: 'fast' },
    { type: '720p', width: 1280, height: 720, bitrate: '1M', videoCodec: 'libx264', audioCodec: 'aac', preset: 'fast' },
    { type: '1080p', width: 1920, height: 1080, bitrate: '2M', videoCodec: 'libx264', audioCodec: 'aac', preset: 'medium' }
  ];

  constructor(private s3Service: S3Service) {}

  /**
   * Validate and sanitize path/URL for FFmpeg/FFprobe to prevent command injection
   * While spawn() with argument arrays is safer than exec(), we still validate inputs
   */
  private validateMediaPath(mediaPath: string): void {
    if (!mediaPath || typeof mediaPath !== 'string') {
      throw new Error('Invalid media path: must be a non-empty string');
    }

    // Check path length to prevent DoS
    if (mediaPath.length > 2048) {
      throw new Error('Invalid media path: path too long');
    }

    // For local file paths, check for path traversal attempts
    if (!mediaPath.startsWith('http://') && !mediaPath.startsWith('https://')) {
      // Resolve to absolute path and check it doesn't escape
      const resolvedPath = path.resolve(mediaPath);
      if (resolvedPath.includes('..')) {
        throw new Error('Invalid media path: path traversal detected');
      }

      // Verify file exists and is a file (not directory or symlink)
      if (!fs.existsSync(resolvedPath)) {
        throw new Error('Invalid media path: file does not exist');
      }

      const stats = fs.statSync(resolvedPath);
      if (!stats.isFile()) {
        throw new Error('Invalid media path: not a regular file');
      }
    }

    // For URLs, validate format
    if (mediaPath.startsWith('http://') || mediaPath.startsWith('https://')) {
      try {
        new URL(mediaPath);
      } catch {
        throw new Error('Invalid media path: malformed URL');
      }
    }
  }

  /**
   * Generate variants for a file
   */
  async generateVariants(fileId: string): Promise<void> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      logger.info('Starting variant generation', { 
        fileId, 
        mime: file.mime,
        size: file.size 
      });

      // Check if variants already exist (for content-addressed files)
      const existingFile = await File.findOne({
        sha256: file.sha256,
        'variants.0': { $exists: true },
        _id: { $ne: file._id }
      });

      if (existingFile && existingFile.variants.length > 0) {
        // Reuse existing variants
  file.variants = existingFile.variants;
  await this.commitVariants(file);
        
        logger.info('Reused existing variants for duplicate content', { 
          fileId, 
          sourceFileId: existingFile._id,
          variantCount: existingFile.variants.length
        });
        return;
      }

      // Generate new variants based on file type
      if (file.mime.startsWith('image/')) {
        await this.generateImageVariants(file);
      } else if (file.mime.startsWith('video/')) {
        await this.generateVideoVariants(file);
      } else if (file.mime === 'application/pdf') {
        await this.generatePdfVariants(file);
      }

      logger.info('Variant generation completed', { 
        fileId, 
        variantCount: file.variants.length 
      });
    } catch (error) {
      logger.error('Error generating variants:', error);
      throw error;
    }
  }

  /**
   * Generate all standard image variants using Sharp.
   */
  private async generateImageVariants(file: IFile): Promise<void> {
    try {
      logger.info('Generating image variants', { fileId: file._id });

      const originalBuffer = await this.s3Service.downloadBuffer(file.storageKey);
      const base = sharp(originalBuffer, { failOn: 'none' });
      const meta = await base.metadata();

      const variants: IFileVariant[] = [];
      for (const config of this.imageVariants) {
        const variantKey = this.generateVariantKey(file.sha256, config.type, config.format || 'webp');

        const width = config.width || meta.width || 1280;
        const height = config.height; // let sharp maintain aspect by only setting width unless both provided
        let pipeline = sharp(originalBuffer, { failOn: 'none' }).rotate();
        pipeline = pipeline.resize({ width, height, fit: 'inside', withoutEnlargement: true });

        // Set format and quality
        const format = (config.format || 'webp');
  if (format === 'webp') pipeline = pipeline.webp({ quality: config.quality ?? 82 });
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: config.quality ?? 82 });
  if (format === 'png') pipeline = pipeline.png();

        const out = await pipeline.toBuffer();
        await this.s3Service.uploadBuffer(variantKey, out, {
          contentType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
        });

        variants.push({
          type: config.type,
          key: variantKey,
          width,
          height: height || Math.round((meta.height || width) * (width / (meta.width || width))),
          readyAt: new Date(),
          size: out.length,
          metadata: { format, quality: config.quality }
        });

        logger.debug('Generated image variant', { fileId: file._id, type: config.type, key: variantKey });
      }

  file.variants = variants;
  await this.commitVariants(file);

      logger.info('Image variants generated', { fileId: file._id, variantCount: variants.length });
    } catch (error) {
      logger.error('Error generating image variants:', error);
      throw error;
    }
  }

  /**
   * Generate video variants with FFmpeg
   * Generates poster frame, multiple bitrate variants, and HLS streams
   */
  private async generateVideoVariants(file: IFile): Promise<void> {
    try {
      logger.info('Generating video variants with FFmpeg', { fileId: file._id });

      // Get S3 presigned URL - FFmpeg can read directly from HTTP URLs
      const videoUrl = await this.s3Service.getPresignedDownloadUrl(file.storageKey, 3600);
      
      // Extract video metadata using S3 presigned URL (no download needed)
      const metadata = await this.extractVideoMetadataFromUrl(videoUrl);
      
      const variants: IFileVariant[] = [];

      // Generate poster frame at 1 second (or 10% of duration, whichever is smaller)
      const posterTime = Math.min(1, (metadata.duration || 60) * 0.1);
      const posterVariant = await this.generatePosterFrame(
        file.storageKey, // Use S3 storage key directly - no temp files
        file.sha256,
        posterTime,
        metadata // Pass metadata to preserve exact aspect ratio
      );
      variants.push(posterVariant);

      // Generate multiple bitrate variants
      for (const config of this.videoVariants) {
        // Skip if source resolution is smaller than target
        if (metadata.width && metadata.height) {
          if (config.width && config.width > metadata.width) {
            logger.debug('Skipping variant larger than source', {
              type: config.type,
              sourceWidth: metadata.width,
              targetWidth: config.width
            });
            continue;
          }
        }

        const variant = await this.generateVideoVariant(
          videoUrl, // Use S3 presigned URL directly - no temp files
          file.sha256,
          config
        );
        if (variant) {
          variants.push(variant);
        }
      }

      // Generate HLS stream (adaptive streaming)
      const hlsVariants = await this.generateHLSStream(
        videoUrl, // Use S3 presigned URL directly - no temp files
        file.sha256,
        metadata
      );
      variants.push(...hlsVariants);

      // Store original video metadata
      file.metadata = {
        ...file.metadata,
        video: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          bitrate: metadata.bitrate,
          fps: metadata.fps,
          codec: metadata.codec,
          audioCodec: metadata.audioCodec
        }
      };

      file.variants = variants;
      await this.commitVariants(file);

      logger.info('Video variants generated successfully', {
        fileId: file._id,
        variantCount: variants.length,
        metadata
      });
    } catch (error) {
      logger.error('Error generating video variants:', error);
      throw error;
    }
  }

  /**
   * Extract video metadata using FFprobe (local file path version)
   * Currently unused - using extractVideoMetadataFromUrl for S3 URLs
   * Kept for potential future local file processing
   */
  private async _extractVideoMetadata(videoPath: string): Promise<{
    duration?: number;
    width?: number;
    height?: number;
    bitrate?: number;
    fps?: number;
    codec?: string;
    audioCodec?: string;
  }> {
    try {
      // Validate path to prevent command injection
      this.validateMediaPath(videoPath);

      // Use spawn for better cross-platform compatibility
      return new Promise((resolve) => {
        const args = [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format',
          '-show_streams',
          videoPath
        ];

        // Verify ffprobe path exists before spawning
        if (!fs.existsSync(ffprobePath)) {
          logger.warn('FFprobe binary not found', { path: ffprobePath });
          resolve({});
          return;
        }

        logger.debug('Spawning ffprobe process', { path: ffprobePath, args });
        const ffprobeProcess = spawn(ffprobePath, args);
        let stdout = '';
        let stderr = '';

        ffprobeProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ffprobeProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffprobeProcess.on('close', (code) => {
          if (code !== 0) {
            logger.warn('FFprobe failed', { code, stderr });
            resolve({});
            return;
          }

          try {
            const metadata = JSON.parse(stdout) as FFprobeMetadata;

            const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
            const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');

            resolve({
              duration: metadata.format?.duration ? parseFloat(metadata.format.duration) : undefined,
              width: videoStream?.width,
              height: videoStream?.height,
              bitrate: metadata.format?.bit_rate ? parseInt(metadata.format.bit_rate) : undefined,
              fps: videoStream?.r_frame_rate ? this.parseFps(videoStream.r_frame_rate) : undefined,
              codec: videoStream?.codec_name,
              audioCodec: audioStream?.codec_name
            });
          } catch (error) {
            logger.warn('Error parsing FFprobe output', { error, stdout });
            resolve({});
          }
        });

        ffprobeProcess.on('error', (err) => {
          logger.warn('FFprobe process error', { error: err });
          resolve({});
        });
      });
    } catch (error) {
      logger.warn('Error extracting video metadata, using defaults', { error });
      return {};
    }
  }

  /**
   * Parse FPS string (e.g., "30/1" -> 30)
   */
  private parseFps(fpsString: string): number {
    const [num, den] = fpsString.split('/').map(Number);
    return den ? num / den : num;
  }

  /**
   * Generate poster frame (thumbnail) from video
   * Maintains the video's exact aspect ratio (vertical videos stay vertical)
   * Uses S3 presigned URL directly with FFmpeg - no temp files, production-ready
   */
  private async generatePosterFrame(
    videoStorageKey: string,
    sha256: string,
    timeSeconds: number,
    metadata?: { width?: number; height?: number }
  ): Promise<IFileVariant> {
    const posterKey = this.generateVariantKey(sha256, 'poster', 'jpg');

    // Get S3 presigned URL for the video (FFmpeg supports HTTP input)
    const videoUrl = await this.s3Service.getPresignedDownloadUrl(videoStorageKey, 3600);
    
    // Extract metadata if not provided (using S3 URL)
    if (!metadata || !metadata.width || !metadata.height) {
      metadata = await this.extractVideoMetadataFromUrl(videoUrl);
    }

    const videoWidth = metadata.width || 1920;
    const videoHeight = metadata.height || 1080;
    const aspectRatio = videoWidth / videoHeight;

    // Use FFmpeg's built-in aspect ratio preservation
    // Scale to max 1920px while maintaining exact aspect ratio (no stretching)
    let scaleFilter: string;
    
    if (videoWidth >= videoHeight) {
      // Landscape or square: constrain width to 1920, let FFmpeg calculate height to preserve aspect ratio
      scaleFilter = 'scale=1920:-1:force_original_aspect_ratio=decrease';
    } else {
      // Vertical/portrait: constrain height to 1920, let FFmpeg calculate width to preserve aspect ratio
      scaleFilter = 'scale=-1:1920:force_original_aspect_ratio=decrease';
    }

    return new Promise((resolve, reject) => {
      // Generate poster with scaling to max 1920px while maintaining exact aspect ratio
      // Stream output directly to stdout (memory) - no temp files
      const args = [
        '-i', videoUrl, // Use S3 presigned URL directly
        '-ss', timeSeconds.toString(),
        '-vframes', '1',
        '-vf', scaleFilter,
        '-q:v', '2',
        '-f', 'image2pipe', // Output to pipe
        '-vcodec', 'mjpeg', // JPEG format for pipe
        'pipe:1' // Output to stdout
      ];

      // Verify ffmpeg path exists before spawning
      if (!fs.existsSync(ffmpegPath)) {
        reject(new Error(`FFmpeg binary not found at path: ${ffmpegPath}. Please install ffmpeg-static or ensure system ffmpeg is available.`));
        return;
      }

      logger.debug('Spawning ffmpeg process for poster from S3', { 
        path: ffmpegPath, 
        videoUrl: videoUrl.substring(0, 50) + '...',
        videoWidth,
        videoHeight,
        aspectRatio,
        scaleFilter
      });
      
      const ffmpegProcess = spawn(ffmpegPath, args);

      let stderr = '';
      const stdoutChunks: Buffer[] = [];

      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpegProcess.stdout.on('data', (data) => {
        stdoutChunks.push(data);
      });

      ffmpegProcess.on('close', async (code) => {
        if (code !== 0) {
          logger.error('Poster generation failed', { code, stderr: stderr.substring(0, 500) });
          reject(new Error(`Poster generation failed with code ${code}: ${stderr.substring(0, 200)}`));
          return;
        }

        try {
          // Get poster from stdout (no temp file needed)
          const posterBuffer = Buffer.concat(stdoutChunks);
          
          // Optimize poster with Sharp (no resize, just optimize)
          const optimized = await sharp(posterBuffer)
            .jpeg({ quality: 85 })
            .toBuffer();

          // Upload to S3
          await this.s3Service.uploadBuffer(posterKey, optimized, {
            contentType: 'image/jpeg'
          });

          const imageMetadata = await sharp(optimized).metadata();
          resolve({
            type: 'poster',
            key: posterKey,
            width: imageMetadata.width || videoWidth,
            height: imageMetadata.height || videoHeight,
            readyAt: new Date(),
            size: optimized.length,
            metadata: { 
              type: 'poster', 
              position: `${timeSeconds}s`, 
              format: 'jpg',
              originalAspectRatio: aspectRatio,
              videoWidth,
              videoHeight
            }
          });
        } catch (error) {
          reject(error);
        }
      });

      ffmpegProcess.on('error', (err) => {
        reject(new Error(`Poster generation failed: ${err.message}`));
      });
    });
  }

  /**
   * Extract video metadata from S3 URL (for presigned URLs)
   */
  private async extractVideoMetadataFromUrl(videoUrl: string): Promise<{
    duration?: number;
    width?: number;
    height?: number;
    bitrate?: number;
    fps?: number;
    codec?: string;
    audioCodec?: string;
  }> {
    try {
      // Validate URL to prevent command injection
      this.validateMediaPath(videoUrl);

      // Use spawn for better cross-platform compatibility
      return new Promise((resolve) => {
        const args = [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format',
          '-show_streams',
          videoUrl
        ];

        const ffprobeProcess = spawn(ffprobePath, args);
        let stdout = '';
        let stderr = '';

        ffprobeProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ffprobeProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffprobeProcess.on('close', (code) => {
          if (code !== 0) {
            logger.warn('FFprobe failed from URL', { code, stderr });
            resolve({});
            return;
          }

          try {
            const metadata = JSON.parse(stdout) as FFprobeMetadata;

            const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
            const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');

            resolve({
              duration: metadata.format?.duration ? parseFloat(metadata.format.duration) : undefined,
              width: videoStream?.width,
              height: videoStream?.height,
              bitrate: metadata.format?.bit_rate ? parseInt(metadata.format.bit_rate) : undefined,
              fps: videoStream?.r_frame_rate ? this.parseFps(videoStream.r_frame_rate) : undefined,
              codec: videoStream?.codec_name,
              audioCodec: audioStream?.codec_name
            });
          } catch (error) {
            logger.warn('Error parsing FFprobe output from URL', { error, stdout });
            resolve({});
          }
        });

        ffprobeProcess.on('error', (err) => {
          logger.warn('FFprobe process error from URL', { error: err });
          resolve({});
        });
      });
    } catch (error) {
      logger.warn('Error extracting video metadata from URL, using defaults', { error });
      return {};
    }
  }

  /**
   * Generate a video variant with specific encoding settings
   * Uses S3 presigned URL directly - streams output to memory, no temp files
   */
  private async generateVideoVariant(
    videoUrl: string,
    sha256: string,
    config: VideoVariantConfig
  ): Promise<IFileVariant | null> {
    const variantKey = this.generateVariantKey(sha256, config.type, 'mp4');

    return new Promise((resolve) => {
      const args = [
        '-i', videoUrl, // Use S3 presigned URL directly
        '-c:v', config.videoCodec || 'libx264',
        '-c:a', config.audioCodec || 'aac',
        '-b:v', config.bitrate || '1M',
        '-movflags', '+faststart', // Enable progressive download
        '-preset', config.preset || 'fast',
        '-crf', '23', // Constant rate factor for quality
        '-pix_fmt', 'yuv420p', // Compatibility
        '-avoid_negative_ts', 'make_zero',
        '-f', 'mp4', // Output format
        'pipe:1' // Output to stdout (memory)
      ];

      // Set resolution if specified
      if (config.width && config.height) {
        args.push('-vf', `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`);
      }

      // Verify ffmpeg path exists before spawning
      if (!fs.existsSync(ffmpegPath)) {
        logger.error('FFmpeg binary not found', { path: ffmpegPath, variant: config.type });
        resolve(null);
        return;
      }

      logger.debug('FFmpeg command for variant', { 
        variant: config.type,
        videoUrl: videoUrl.substring(0, 50) + '...'
      });

      const ffmpegProcess = spawn(ffmpegPath, args);

      let stderr = '';
      const stdoutChunks: Buffer[] = [];
      let _lastProgress = '';

      ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        
        // Parse progress from ffmpeg output
        const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          _lastProgress = totalSeconds.toString();
        }
      });

      ffmpegProcess.stdout.on('data', (data) => {
        stdoutChunks.push(data);
      });

      ffmpegProcess.on('close', async (code) => {
        if (code !== 0) {
          logger.error('Video variant generation failed', { 
            variant: config.type, 
            code,
            error: stderr.substring(0, 500)
          });
          resolve(null); // Don't fail entire process if one variant fails
          return;
        }

        try {
          // Get variant from stdout (no temp file needed)
          const variantBuffer = Buffer.concat(stdoutChunks);

          // Upload to S3
          await this.s3Service.uploadBuffer(variantKey, variantBuffer, {
            contentType: 'video/mp4'
          });

          resolve({
            type: config.type,
            key: variantKey,
            width: config.width,
            height: config.height,
            readyAt: new Date(),
            size: variantBuffer.length,
            metadata: {
              bitrate: config.bitrate,
              codec: config.videoCodec,
              audioCodec: config.audioCodec,
              preset: config.preset,
              format: 'mp4'
            }
          });
        } catch (error) {
          logger.error('Error processing video variant', { variant: config.type, error });
          resolve(null);
        }
      });

      ffmpegProcess.on('error', (err) => {
        logger.error('FFmpeg process error', { variant: config.type, error: err });
        resolve(null);
      });
    });
  }

  /**
   * Generate HLS (HTTP Live Streaming) streams with adaptive bitrate
   * Uses S3 presigned URL directly - segments are uploaded to S3 immediately and temp files cleaned up
   * Note: HLS requires temp files for segment generation, but they're deleted immediately after upload to S3
   */
  private async generateHLSStream(
    videoUrl: string,
    sha256: string,
    metadata: { width?: number; height?: number; duration?: number }
  ): Promise<IFileVariant[]> {
    // Use /tmp for HLS segments (ephemeral, OS cleans up automatically)
    // FFmpeg needs to write multiple segment files for HLS
    const tempDir = path.join('/tmp', 'oxy-hls', sha256.substring(0, 8));
    const hlsDir = path.join(tempDir, 'hls');
    let cleanupTemp = false;

    return new Promise((resolve, reject) => {
      try {
        // Create HLS output directory (temporary, for segment generation)
        fs.mkdirSync(hlsDir, { recursive: true });
        cleanupTemp = true;
      } catch (error) {
        reject(new Error(`Failed to create HLS temp directory: ${error}`));
        return;
      }

      const variants: IFileVariant[] = [];

      // Generate HLS variants for each quality
      const hlsVariants: Array<{ resolution: string; bitrate: string; playlist: string }> = [];
      const availableVariants = this.videoVariants.filter(v => {
        // Only include variants that are smaller or equal to source
        return !v.width || !metadata.width || v.width <= metadata.width;
      });

      if (availableVariants.length === 0) {
        // Fallback to original resolution
        availableVariants.push({
          type: 'source',
          width: metadata.width,
          height: metadata.height,
          bitrate: '2M',
          videoCodec: 'libx264',
          audioCodec: 'aac',
          preset: 'fast'
        });
      }

      let processedCount = 0;
      const totalVariants = availableVariants.length;

      availableVariants.forEach((config) => {
        const playlistName = `stream_${config.type}.m3u8`;
        const outputPath = path.join(hlsDir, playlistName);
        const segmentPattern = path.join(hlsDir, `segment_${config.type}_%03d.ts`);

        const args = [
          '-i', videoUrl, // Use S3 presigned URL directly
          '-c:v', config.videoCodec || 'libx264',
          '-c:a', config.audioCodec || 'aac',
          '-b:v', config.bitrate || '1M',
          '-f', 'hls',
          '-hls_time', '10', // 10 second segments
          '-hls_list_size', '0', // Keep all segments in playlist
          '-hls_segment_filename', segmentPattern,
          '-hls_flags', 'independent_segments',
          '-preset', config.preset || 'fast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-sc_threshold', '0',
          '-g', '48',
          '-keyint_min', '48'
        ];

        if (config.width && config.height) {
          args.push('-vf', `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`);
        }

        args.push('-y', outputPath); // Overwrite output file

        const ffmpegProcess = spawn(ffmpegPath, args);

        let stderr = '';

        ffmpegProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpegProcess.on('close', async (code) => {
          if (code !== 0) {
            logger.error('HLS variant generation failed', { 
              variant: config.type, 
              code,
              error: stderr 
            });
            processedCount++;
            if (processedCount === totalVariants) {
              resolve(variants);
            }
            return;
          }

          try {
            // Upload HLS playlist and segments
            const playlistBuffer = fs.readFileSync(outputPath);
            const playlistKey = this.generateVariantKey(sha256, `hls_${config.type}`, 'm3u8');
            await this.s3Service.uploadBuffer(playlistKey, playlistBuffer, {
              contentType: 'application/vnd.apple.mpegurl'
            });

            // Upload all segment files and delete immediately after upload
            const segments = fs.readdirSync(hlsDir).filter(f => f.startsWith(`segment_${config.type}_`));
            for (const segment of segments) {
              const segmentPath = path.join(hlsDir, segment);
              const segmentBuffer = fs.readFileSync(segmentPath);
              const segmentKey = this.generateVariantKey(sha256, `hls_${config.type}_${segment}`, 'ts');
              await this.s3Service.uploadBuffer(segmentKey, segmentBuffer, {
                contentType: 'video/mp2t'
              });
              // Delete segment immediately after upload (no temp file accumulation)
              try {
                fs.unlinkSync(segmentPath);
              } catch {
                // Ignore deletion errors
              }
            }

            // Delete playlist file after upload
            try {
              fs.unlinkSync(outputPath);
            } catch {
              // Ignore deletion errors
            }

            hlsVariants.push({
              resolution: config.width && config.height ? `${config.width}x${config.height}` : 'source',
              bitrate: config.bitrate || '1M',
              playlist: playlistKey
            });

            variants.push({
              type: `hls_${config.type}`,
              key: playlistKey,
              width: config.width,
              height: config.height,
              readyAt: new Date(),
              metadata: {
                format: 'hls',
                bitrate: config.bitrate,
                segments: segments.length
              }
            });

            processedCount++;
            if (processedCount === totalVariants) {
              // Generate master playlist
              const masterPlaylist = this.generateMasterPlaylist(hlsVariants);
              const masterKey = this.generateVariantKey(sha256, 'hls_master', 'm3u8');
              await this.s3Service.uploadBuffer(masterKey, Buffer.from(masterPlaylist), {
                contentType: 'application/vnd.apple.mpegurl'
              });

              variants.push({
                type: 'hls_master',
                key: masterKey,
                readyAt: new Date(),
                metadata: {
                  format: 'hls',
                  variantCount: hlsVariants.length,
                  variants: hlsVariants.map(v => v.resolution)
                }
              });

              // Cleanup temp directory after all uploads (all segments uploaded to S3)
              if (cleanupTemp && fs.existsSync(tempDir)) {
                try {
                  fs.rmSync(tempDir, { recursive: true, force: true });
                  logger.debug('Cleaned up HLS temp directory after uploads', { tempDir });
                } catch (cleanupError) {
                  logger.warn('Error cleaning up HLS temp files', { tempDir, error: cleanupError });
                }
              }

              resolve(variants);
            }
          } catch (error) {
            logger.error('Error processing HLS variant', { variant: config.type, error });
            processedCount++;
            if (processedCount === totalVariants) {
              resolve(variants);
            }
          }
        });

        ffmpegProcess.on('error', (err) => {
          logger.error('FFmpeg process error for HLS', { variant: config.type, error: err });
          processedCount++;
          if (processedCount === totalVariants) {
            resolve(variants);
          }
        });
      });
    });
  }

  /**
   * Generate HLS master playlist
   */
  private generateMasterPlaylist(variants: Array<{ resolution: string; bitrate: string; playlist: string }>): string {
    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

    variants.forEach((variant) => {
      const bitrateNumber = this.parseBitrate(variant.bitrate);
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bitrateNumber},RESOLUTION=${variant.resolution}\n`;
      playlist += `${variant.playlist}\n\n`;
    });

    return playlist;
  }

  /**
   * Parse bitrate string to number (e.g., "1M" -> 1000000)
   */
  private parseBitrate(bitrate: string): number {
    const match = bitrate.match(/^(\d+)([kKmM])?$/);
    if (!match) return 1000000;

    const value = parseInt(match[1]);
    const unit = match[2]?.toLowerCase();

    if (unit === 'k') return value * 1000;
    if (unit === 'm') return value * 1000000;
    return value;
  }

  /**
   * Generate PDF variants (first page thumbnail)
   */
  private async generatePdfVariants(file: IFile): Promise<void> {
    // This would use pdf2pic or similar to generate thumbnails
    // For now, this is a placeholder
    
    try {
      logger.info('Generating PDF variants (placeholder)', { fileId: file._id });

      const thumbnailKey = this.generateVariantKey(file.sha256, 'thumb', 'jpg');
      
      // Placeholder variant
      const variants: IFileVariant[] = [{
        type: 'thumb',
        key: thumbnailKey,
        width: 256,
        height: 256,
        readyAt: new Date(),
        metadata: { page: 1 }
      }];

  file.variants = variants;
  await this.commitVariants(file);

      logger.info('PDF variants generated (placeholder)', {
        fileId: file._id,
        variantCount: variants.length
      });
    } catch (error) {
      logger.error('Error generating PDF variants:', error);
      throw error;
    }
  }

  /**
   * Generate variant storage key
   */
  private generateVariantKey(sha256: string, variantType: string, format: string): string {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const prefix = sha256.substring(0, 2);
    
    return `variants/${year}/${month}/${prefix}/${sha256}/${variantType}.${format}`;
  }

  /**
   * Get available variants for a file
   */
  async getVariants(fileId: string): Promise<IFileVariant[]> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      return file.variants.filter(variant => variant.readyAt);
    } catch (error) {
      logger.error('Error getting variants:', error);
      throw error;
    }
  }

  /**
   * Check if variant exists and is ready
   */
  async isVariantReady(fileId: string, variantType: string): Promise<boolean> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        return false;
      }

      const variant = file.variants.find(v => v.type === variantType);
      return !!(variant && variant.readyAt);
    } catch (error) {
      logger.error('Error checking variant readiness:', error);
      return false;
    }
  }

  /**
   * Ensure a specific video poster variant exists, generate via FFmpeg if missing.
   */
  async ensureVideoPoster(file: IFile): Promise<IFileVariant> {
    const existing = file.variants.find(v => v.type === 'poster' && v.readyAt);
    if (existing) {
      return existing;
    }

    // Generate poster frame directly from S3 - no temp files
    try {
      // Get S3 presigned URL and extract metadata
      const videoUrl = await this.s3Service.getPresignedDownloadUrl(file.storageKey, 3600);
      const metadata = await this.extractVideoMetadataFromUrl(videoUrl);
      const posterTime = Math.min(1, (metadata.duration || 60) * 0.1);

      // Generate poster frame with exact video aspect ratio (streams directly from S3)
      const posterVariant = await this.generatePosterFrame(
        file.storageKey, // Use S3 storage key directly - no temp files
        file.sha256,
        posterTime,
        metadata // Pass metadata to preserve exact aspect ratio
      );

      // Update file variants
      const idx = file.variants.findIndex(v => v.type === 'poster');
      if (idx >= 0) file.variants[idx] = posterVariant;
      else file.variants.push(posterVariant);

      try {
        await this.commitVariants(file);
      } catch (error) {
        logger.warn('Failed committing poster variant, retrying', { fileId: file._id, error });
        // Retry once with fresh document
        const fresh = await File.findById(file._id);
        if (fresh) {
          const idx2 = fresh.variants.findIndex(v => v.type === 'poster');
          if (idx2 >= 0) fresh.variants[idx2] = posterVariant;
          else fresh.variants.push(posterVariant);
          try {
            await File.updateOne({ _id: fresh._id }, { $set: { variants: fresh.variants } });
          } catch (err2) {
            logger.error('Retry failed committing poster variant', { fileId: file._id, error: err2 });
          }
        }
      }

      return posterVariant;
    } catch (error) {
      logger.error('Error ensuring video poster', { fileId: file._id, error });
      throw error;
    }
  }

  /**
   * Ensure a specific image variant exists, generate via Sharp if missing.
   */
  async ensureImageVariant(file: IFile, variantType: string): Promise<IFileVariant> {
    const existing = file.variants.find(v => v.type === variantType && v.readyAt);
    if (existing) {
      return existing;
    }

    // Map variantType to config
    const config = this.imageVariants.find(v => v.type === variantType);
    if (!config) {
      throw new Error(`Unsupported image variant: ${variantType}`);
    }

    const originalBuffer = await this.s3Service.downloadBuffer(file.storageKey);
    let pipeline = sharp(originalBuffer, { failOn: 'none' }).rotate();
    pipeline = pipeline.resize({ width: config.width, height: config.height, fit: 'inside', withoutEnlargement: true });
    const format = (config.format || 'webp');
  if (format === 'webp') pipeline = pipeline.webp({ quality: config.quality ?? 82 });
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: config.quality ?? 82 });
  if (format === 'png') pipeline = pipeline.png();

    const out = await pipeline.toBuffer();
    const key = this.generateVariantKey(file.sha256, variantType, format);
    await this.s3Service.uploadBuffer(key, out, {
      contentType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
    });

    const imgMeta = await sharp(out).metadata();
    const variant: IFileVariant = {
      type: variantType,
      key,
      width: imgMeta.width || config.width || 0,
      height: imgMeta.height || config.height || 0,
      readyAt: new Date(),
      size: out.length,
      metadata: { format, quality: config.quality }
    };

    // Upsert in DB
    const idx = file.variants.findIndex(v => v.type === variantType);
    if (idx >= 0) file.variants[idx] = variant;
    else file.variants.push(variant);
    try {
      await this.commitVariants(file);
    } catch (error) {
      logger.warn('Failed committing single ensured variant, retrying fetch & update', { fileId: file._id, variantType, error });
      // Retry once with fresh document to mitigate race conditions
      const fresh = await File.findById(file._id);
      if (fresh) {
        const idx2 = fresh.variants.findIndex(v => v.type === variantType);
        if (idx2 >= 0) fresh.variants[idx2] = variant; else fresh.variants.push(variant);
        try {
          await File.updateOne({ _id: fresh._id }, { $set: { variants: fresh.variants } });
        } catch (err2) {
          logger.error('Retry failed committing ensured variant', { fileId: file._id, variantType, error: err2 });
        }
      }
    }

    return variant;
  }
}

// Helper methods appended to class
// VariantCommitRetryOptions is imported from types file

// Extend class with private method via declaration merging pattern
declare module './variantService' {
  interface VariantService {
    commitVariants(file: IFile, options?: VariantCommitRetryOptions): Promise<void>;
  }
}

VariantService.prototype.commitVariants = async function(file: IFile, options: VariantCommitRetryOptions = {}): Promise<void> {
  const { retries, delayMs, maxRetries = 2, retryDelay = 60 } = options;
  const actualRetries = retries ?? maxRetries;
  const actualDelay = delayMs ?? retryDelay;
  let attempt = 0;
  // We only update the variants field to avoid version key conflicts; using updateOne bypasses optimistic concurrency
  while (attempt <= actualRetries) {
    try {
      await File.updateOne({ _id: file._id }, { $set: { variants: file.variants } }).exec();
      return;
    } catch (err: any) {
      if (String(err?.name) === 'VersionError' && attempt < actualRetries) {
        logger.warn('VersionError committing variants, retrying', { fileId: file._id, attempt });
        await new Promise(res => setTimeout(res, actualDelay * (attempt + 1)));
        // Refresh variants from DB to merge if needed
        const fresh = await File.findById(file._id);
        if (fresh) {
          // Simple merge preferring in-memory variants by type
            const merged: IFileVariant[] = [];
            const byType: Record<string, IFileVariant> = {};
            for (const v of fresh.variants) byType[v.type] = v;
            for (const v of file.variants) byType[v.type] = v; // overwrite with latest
            for (const k of Object.keys(byType)) merged.push(byType[k]);
            file.variants = merged;
        }
        attempt++;
        continue;
      }
      logger.error('Failed to commit variants', { fileId: file._id, attempt, error: err });
      throw err;
    }
  }
};

// Note: This implementation uses a placeholder for Sharp
// In a real deployment, you would install Sharp with: npm install sharp
// For now, we'll create a mock implementation to avoid build issues