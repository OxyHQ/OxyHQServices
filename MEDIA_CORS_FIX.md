# Media CORS and ORB Error Fix

## Problem Statement

The ERR_BLOCKED_BY_ORB (Opaque Response Blocking) error occurs when media files from the Oxy services (https://api.oxy.so) are loaded in production without proper CORS headers. Modern browsers block cross-origin requests to media resources when they lack appropriate security headers.

### What is ORB?

Opaque Response Blocking (ORB) is a browser security feature that blocks certain cross-origin requests to prevent attacks like Spectre. When a resource is loaded cross-origin without proper headers, browsers may block it to protect sensitive data.

## Root Cause

When `getFileDownloadUrl()` from `@oxyhq/services` generates URLs to the Oxy API, those URLs need proper headers for media streaming:

1. **Missing Cross-Origin-Resource-Policy header** - Required to allow cross-origin access
2. **Missing or incorrect Content-Type header** - Browsers need correct MIME types
3. **CORS headers not properly set** - Access-Control headers must be configured correctly

## Solution

### 1. Created Media Headers Middleware

**File:** `packages/api/src/middleware/mediaHeaders.ts`

This middleware adds all necessary headers to prevent ORB blocking:

```typescript
export const mediaHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Cross-Origin-Resource-Policy allows cross-origin requests
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
  // CORS headers for cross-origin access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
  
  // Expose headers that the client needs to access
  res.setHeader(
    'Access-Control-Expose-Headers', 
    'Content-Type, Content-Length, Content-Range, Accept-Ranges, Content-Disposition'
  );
  
  // Support range requests for video/audio streaming
  res.setHeader('Accept-Ranges', 'bytes');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(204).end();
  }
  
  next();
};
```

### 2. Updated Asset Routes

**File:** `packages/api/src/routes/assets.ts`

Applied middleware to the streaming endpoint:

```typescript
router.get('/:id/stream', mediaHeadersMiddleware, async (req, res) => {
  // Stream from S3/Spaces with proper headers
  const streamInfo = await s3Service.getObjectStream(storageKey);
  
  if (streamInfo.contentType) {
    res.setHeader('Content-Type', streamInfo.contentType);
  }
  if (streamInfo.contentLength) {
    res.setHeader('Content-Length', String(streamInfo.contentLength));
  }
  if (streamInfo.lastModified) {
    res.setHeader('Last-Modified', new Date(streamInfo.lastModified).toUTCString());
  }
  // Cache headers: immutable for content-addressed files
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  
  streamInfo.body.pipe(res);
});
```

### 3. Updated File Routes

**File:** `packages/api/src/routes/files.ts`

Applied middleware to download endpoints:

```typescript
router.get('/download/:key(*)', mediaHeadersMiddleware, async (req, res) => {
  // Download with proper CORS headers
});

router.get('/download', mediaHeadersMiddleware, async (req, res) => {
  // Download with query param with proper CORS headers
});
```

### 4. Enhanced Server CORS Configuration

**File:** `packages/api/src/server.ts`

Added exposed headers to the global CORS configuration:

```typescript
res.setHeader(
  "Access-Control-Expose-Headers",
  [
    'Content-Type',
    'Content-Length',
    'Content-Range',
    'Content-Disposition',
    'Accept-Ranges',
    'Last-Modified',
    'ETag',
    'Cache-Control',
  ].join(', ')
);
```

## Key Headers Explained

### Cross-Origin-Resource-Policy: cross-origin
Allows the resource to be loaded from any origin. This is the most critical header for preventing ORB blocking.

### Access-Control-Allow-Origin: *
Allows any origin to access the resource. For public media files, this is appropriate.

### Access-Control-Expose-Headers
Lists headers that browsers are allowed to access from JavaScript. Essential for clients that need to read Content-Type, Content-Length, etc.

### Accept-Ranges: bytes
Enables range requests, crucial for video/audio streaming where browsers request specific byte ranges.

### Cache-Control
- `public, max-age=31536000, immutable` - For content-addressed files that never change
- `private, max-age=3600` - For user-specific files that might change

## Testing

To verify the fix works:

1. **Check Response Headers:**
   ```bash
   curl -I https://api.oxy.so/api/assets/{id}/stream
   ```
   
   Should include:
   ```
   Cross-Origin-Resource-Policy: cross-origin
   Access-Control-Allow-Origin: *
   Content-Type: image/jpeg (or appropriate MIME type)
   Accept-Ranges: bytes
   ```

2. **Test in Browser:**
   ```javascript
   const img = new Image();
   img.crossOrigin = 'anonymous';
   img.src = 'https://api.oxy.so/api/assets/{id}/stream';
   ```
   
   Should load without ERR_BLOCKED_BY_ORB error.

3. **Check Video Streaming:**
   ```html
   <video src="https://api.oxy.so/api/assets/{id}/stream" controls></video>
   ```
   
   Should play without errors and support seeking (range requests).

## Additional Benefits

1. **Better Caching:** Content-addressed files use immutable caching for optimal CDN performance
2. **Range Request Support:** Videos and audio can be streamed with seek support
3. **Proper MIME Types:** Content-Type headers ensure browsers handle files correctly
4. **OPTIONS Preflight Handling:** Efficient handling of CORS preflight requests

## Related Files

- `packages/api/src/middleware/mediaHeaders.ts` - New middleware
- `packages/api/src/routes/assets.ts` - Updated with middleware
- `packages/api/src/routes/files.ts` - Updated with middleware
- `packages/api/src/server.ts` - Enhanced CORS configuration

## References

- [Opaque Response Blocking (ORB)](https://developer.chrome.com/blog/opaque-response-blocking/)
- [Cross-Origin-Resource-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Resource-Policy)
- [CORS Headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [HTTP Range Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests)
