# Troubleshooting Guide

Common issues and solutions for the Oxy API.

## 🔍 Quick Diagnostics

### Health Check

Check if the API is running properly:

```bash
curl http://localhost:3001/
```

Expected response:
```json
{
  "message": "Welcome to the API",
  "users": 42
}
```

### Database Connection

Check MongoDB connection status in the server logs:
```
Connected to MongoDB successfully
```

## 🚨 Common Issues

### Authentication Issues

#### 1. "Invalid credentials" error

**Symptoms:**
- Login fails with 401 status
- "Invalid credentials" error message

**Causes:**
- Incorrect username/email or password
- User account doesn't exist
- Password hashing mismatch

**Solutions:**
```bash
# Verify user exists
curl -X GET http://localhost:3001/api/users/me \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check password requirements
# - Minimum 6 characters
# - No special requirements
```

#### 2. "Token expired" error

**Symptoms:**
- API calls return 401 with "Token expired"
- Refresh token fails

**Causes:**
- Access token has expired (default: 15 minutes)
- Refresh token has expired (default: 7 days)
- Clock skew between client and server

**Solutions:**
```javascript
// Implement automatic token refresh
const refreshToken = async () => {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: storedRefreshToken })
  });
  
  if (response.ok) {
    const { accessToken } = await response.json();
    // Update stored token
    localStorage.setItem('accessToken', accessToken);
  }
};
```

#### 3. "Unauthorized" error

**Symptoms:**
- Protected endpoints return 403
- "Unauthorized" error message

**Causes:**
- Missing Authorization header
- Invalid token format
- Token doesn't match user

**Solutions:**
```javascript
// Ensure proper header format
headers: {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
}
```

### File Upload Issues

#### 1. "File too large" error

**Symptoms:**
- Upload fails with 413 status
- "File too large" error message

**Causes:**
- File exceeds 50MB limit
- Client-side validation missing

**Solutions:**
```javascript
// Client-side file size check
const maxSize = 50 * 1024 * 1024; // 50MB
if (file.size > maxSize) {
  alert('File too large. Maximum size is 50MB.');
  return;
}
```

#### 2. "Missing required headers" error

**Symptoms:**
- Upload fails with 400 status
- "Missing required headers" error

**Causes:**
- Missing X-File-Name header
- Missing X-User-Id header
- Incorrect Content-Type

**Solutions:**
```javascript
// Ensure all required headers
const response = await fetch('/api/files/upload-raw', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/octet-stream',
    'X-File-Name': file.name,
    'X-User-Id': userId
  },
  body: file
});
```

#### 3. File not found after upload

**Symptoms:**
- Upload succeeds but file can't be accessed
- 404 error when trying to stream file

**Causes:**
- File ID not properly stored
- GridFS connection issues
- File corruption during upload

**Solutions:**
```javascript
// Verify upload response
const result = await response.json();
console.log('File uploaded with ID:', result._id);

// Test file access
const fileUrl = `/api/files/${result._id}`;
const fileResponse = await fetch(fileUrl);
if (fileResponse.ok) {
  console.log('File accessible');
}
```

### Database Issues

#### 1. MongoDB connection failed

**Symptoms:**
- Server fails to start
- "MongoDB connection error" in logs
- API endpoints return 500 errors

**Causes:**
- MongoDB not running
- Incorrect connection string
- Network connectivity issues
- Authentication problems

**Solutions:**
```bash
# Check MongoDB status
sudo systemctl status mongod

# Verify connection string
echo $MONGODB_URI

# Test connection manually
mongosh "mongodb://localhost:27017/oxyapi"
```

#### 2. Database queries slow

**Symptoms:**
- API responses are slow
- Timeout errors
- High CPU usage

**Causes:**
- Missing database indexes
- Large collections without pagination
- Inefficient queries

**Solutions:**
```javascript
// Add indexes for common queries
// In MongoDB shell:
db.users.createIndex({ "username": 1 });
db.users.createIndex({ "email": 1 });
db.files.createIndex({ "metadata.userID": 1 });
```

### Rate Limiting Issues

#### 1. "Too many requests" error

**Symptoms:**
- API calls return 429 status
- "Rate limit exceeded" error
- Temporary blocking

**Causes:**
- Exceeded rate limits
- Rapid successive requests
- Multiple clients from same IP

**Solutions:**
```javascript
// Implement exponential backoff
const makeRequest = async (url, options, retries = 3) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (retries > 0 && error.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
      return makeRequest(url, options, retries - 1);
    }
    throw error;
  }
};
```

### Session Management Issues

#### 1. Multiple sessions not working

**Symptoms:**
- Can't login from multiple devices
- Sessions conflict with each other
- Unexpected logouts

**Causes:**
- Session management configuration
- Token conflicts
- Device fingerprint issues

**Solutions:**
```javascript
// Use device-specific sessions
const loginWithDevice = async (credentials, deviceInfo) => {
  const response = await fetch('/api/secure-session/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...credentials,
      deviceFingerprint: generateDeviceFingerprint(),
      deviceInfo
    })
  });
  return response.json();
};
```

## 🔧 Debugging

### Enable Debug Logging

Add debug logging to your application:

```javascript
// Server-side logging
console.log('Request details:', {
  method: req.method,
  path: req.path,
  headers: req.headers,
  body: req.body
});

// Client-side logging
console.log('API response:', {
  status: response.status,
  headers: response.headers,
  data: await response.json()
});
```

### Check Server Logs

Monitor server logs for errors:

```bash
# Development mode
npm run dev

# Production mode
npm start

# Check logs
tail -f logs/app.log
```

### Network Debugging

Use browser dev tools or curl to debug requests:

```bash
# Verbose curl request
curl -v -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"password123"}'
```

## 🛠️ Performance Issues

### Slow Response Times

**Diagnosis:**
```bash
# Test response time
time curl http://localhost:3001/api/users/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Solutions:**
- Add database indexes
- Implement caching
- Optimize queries
- Use connection pooling

### Memory Issues

**Symptoms:**
- High memory usage
- Server crashes
- Slow performance

**Solutions:**
- Monitor memory usage
- Implement garbage collection
- Optimize file uploads
- Use streaming for large files

## 🔒 Security Issues

### CORS Errors

**Symptoms:**
- Browser blocks requests
- "CORS policy" errors
- Preflight request failures

**Solutions:**
```javascript
// Check allowed origins
const allowedOrigins = [
  "https://mention.earth",
  "https://homiio.com", 
  "https://api.oxy.so",
  "http://localhost:8081"
];

// Ensure your domain is included
```

### JWT Token Security

**Best Practices:**
- Use strong secrets (64+ characters)
- Rotate secrets regularly
- Set appropriate expiration times
- Validate tokens on every request

## 📞 Getting Help

### Logs to Collect

When reporting issues, include:

1. **Server logs** - Complete error stack traces
2. **Request details** - Method, URL, headers, body
3. **Response details** - Status code, headers, body
4. **Environment info** - Node.js version, OS, MongoDB version
5. **Steps to reproduce** - Detailed reproduction steps

### Common Debug Commands

```bash
# Check Node.js version
node --version

# Check npm version
npm --version

# Check MongoDB version
mongosh --version

# Check disk space
df -h

# Check memory usage
free -h

# Check network connectivity
ping localhost
```

### Support Channels

- **GitHub Issues** - For bug reports and feature requests
- **Documentation** - Check this guide and API reference
- **Examples** - Review integration examples
- **Community** - Join developer community forums

## 🔄 Recovery Procedures

### Database Recovery

```bash
# Backup database
mongodump --db oxyapi --out backup/

# Restore database
mongorestore --db oxyapi backup/oxyapi/
```

### File System Recovery

```bash
# Check GridFS integrity
# This would require custom script to validate file chunks

# Rebuild indexes
mongosh oxyapi --eval "db.fs.files.reIndex()"
```

### Application Recovery

```bash
# Restart application
npm run dev

# Clear cache
npm run clean

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## 📊 Monitoring

### Health Checks

Implement regular health checks:

```bash
# Basic health check
curl http://localhost:3001/health

# Database health check
curl http://localhost:3001/health/db

# File system health check
curl http://localhost:3001/health/files
```

### Metrics to Monitor

- Response times
- Error rates
- Database connection status
- File upload success rates
- Memory usage
- CPU usage
- Disk space

### Alerting

Set up alerts for:
- High error rates (>5%)
- Slow response times (>2s)
- Database connection failures
- Disk space low (<10%)
- Memory usage high (>80%) 