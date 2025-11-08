# DigitalOcean Spaces CORS Configuration

**Issue:** Presigned URL uploads to DigitalOcean Spaces fail with CORS error
**Error:** `No 'Access-Control-Allow-Origin' header is present on the requested resource`

## Problem

When uploading files directly from the browser to DigitalOcean Spaces using presigned URLs, the browser makes a CORS preflight request (OPTIONS) that must be allowed by the Spaces bucket.

## Solution: Configure CORS on Your DigitalOcean Space

### Option 1: Using DigitalOcean Web Console

1. Go to your [DigitalOcean Spaces](https://cloud.digitalocean.com/spaces)
2. Select your Space (e.g., `oxy-development-bucket`)
3. Click on **Settings** tab
4. Scroll to **CORS Configurations**
5. Click **Add CORS Configuration**
6. Add the following configuration:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-request-id</ExposeHeader>
    <ExposeHeader>x-amz-id-2</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
```

### Option 2: Using AWS CLI (s3cmd or aws-cli)

If you have `s3cmd` or AWS CLI configured for DigitalOcean Spaces:

**Create a file `cors.xml`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-request-id</ExposeHeader>
    <ExposeHeader>x-amz-id-2</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
```

**Apply using s3cmd:**
```bash
s3cmd setcors cors.xml s3://oxy-development-bucket
```

**Or using AWS CLI:**
```bash
aws s3api put-bucket-cors \
  --bucket oxy-development-bucket \
  --endpoint-url https://ams3.digitaloceanspaces.com \
  --cors-configuration file://cors.xml
```

### Option 3: Restrictive CORS (Recommended for Production)

For production, limit allowed origins to your actual domains:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>https://oxy.so</AllowedOrigin>
    <AllowedOrigin>https://www.oxy.so</AllowedOrigin>
    <AllowedOrigin>https://app.oxy.so</AllowedOrigin>
    <AllowedOrigin>http://localhost:8081</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-request-id</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
```

## Verification

After applying CORS configuration, test with:

```bash
curl -X OPTIONS \
  https://oxy-development-bucket.ams3.digitaloceanspaces.com/test.jpg \
  -H "Origin: http://localhost:8081" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" \
  -v
```

You should see:
```
< HTTP/1.1 200 OK
< Access-Control-Allow-Origin: *
< Access-Control-Allow-Methods: GET, POST, PUT, DELETE, HEAD
< Access-Control-Max-Age: 3600
```

## Fallback: Direct Upload via API

If you cannot configure CORS on your Spaces bucket (or prefer server-side uploads), the application already has a fallback mechanism that uploads through your API server instead:

1. Frontend attempts presigned URL upload
2. If CORS fails, automatically falls back to: `POST /api/assets/:id/upload-direct`
3. API server uploads to Spaces on behalf of the client

This fallback is already implemented in `OxyServices.assetUpload()`.

## Environment Variables

Ensure these are set correctly:

```env
# DigitalOcean Spaces Configuration
S3_REGION=ams3
S3_ACCESS_KEY_ID=DO801P7WXFVCXHE9Z9RN
S3_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=oxy-development-bucket
S3_ENDPOINT_URL=https://ams3.digitaloceanspaces.com
```

## Testing

After configuring CORS:

```typescript
// This should work without CORS errors
const asset = await oxyServices.uploadAvatar(file, userId);
```

## Troubleshooting

### Still Getting CORS Errors?

1. **Clear browser cache** - Old preflight responses may be cached
2. **Wait 5 minutes** - CORS changes can take a few minutes to propagate
3. **Check bucket name** - Ensure you're configuring the correct Space
4. **Verify endpoint** - Make sure `ams3` matches your Space's region
5. **Test with curl** - Use the verification command above

### CORS Works But Upload Fails?

Check:
- Presigned URL hasn't expired (default 1 hour)
- Content-Type header matches what was signed
- File size is within limits

### Direct Upload Also Failing?

Check API server logs:
```bash
cd packages/api
npm run dev
```

Look for errors in the `/api/assets/:id/upload-direct` route.

## Best Practice

For **production**:
- ✅ Use restrictive CORS (specific origins only)
- ✅ Keep presigned URL expiration short (15-30 minutes)
- ✅ Monitor S3 access logs
- ✅ Use CDN (DigitalOcean Spaces CDN is built-in)

For **development**:
- ✅ Allow `*` origins (as shown in Option 1)
- ✅ Longer expiration for easier debugging
- ✅ Enable detailed logging

## Related Documentation

- [DigitalOcean Spaces CORS Guide](https://docs.digitalocean.com/products/spaces/how-to/configure-cors/)
- [AWS S3 CORS Configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)
- File Visibility System: `VISIBILITY_SYSTEM_COMPLETE.md`
