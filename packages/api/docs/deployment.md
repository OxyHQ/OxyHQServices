# Deployment Guide

Comprehensive guide for deploying the OxyHQ API to production environments.

## Overview

This guide covers deployment strategies for different environments:
- **Development**: Local development setup
- **Staging**: Pre-production testing environment
- **Production**: Live production environment

## Prerequisites

### System Requirements

- **Node.js**: 18.x or higher
- **MongoDB**: 5.x or higher
- **Redis**: 6.x or higher (optional)
- **Memory**: Minimum 2GB RAM
- **Storage**: Minimum 10GB free space
- **Network**: Stable internet connection

### Production Requirements

- **CPU**: 2+ cores recommended
- **Memory**: 4GB+ RAM recommended
- **Storage**: 50GB+ SSD recommended
- **Network**: High bandwidth, low latency
- **SSL Certificate**: Valid SSL certificate for HTTPS

## Environment Configuration

### Environment Variables

Create environment-specific configuration files:

#### Development (.env.development)
```env
# Server Configuration
NODE_ENV=development
PORT=3001
HOST=localhost

# Database
MONGODB_URI=mongodb://localhost:27017/oxyhq_dev

# Redis (Optional)
REDIS_URL=redis://localhost:6379

# JWT Secrets
ACCESS_TOKEN_SECRET=dev_access_token_secret_here
REFRESH_TOKEN_SECRET=dev_refresh_token_secret_here

# Rate Limiting
RATE_LIMIT_MAX=1000
AUTH_RATE_LIMIT_MAX=5
FILE_UPLOAD_RATE_LIMIT_MAX=50

# Security
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./uploads

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9090
```

#### Staging (.env.staging)
```env
# Server Configuration
NODE_ENV=staging
PORT=3001
HOST=0.0.0.0

# Database
MONGODB_URI=mongodb://staging-db:27017/oxyhq_staging

# Redis
REDIS_URL=redis://staging-redis:6379

# JWT Secrets
ACCESS_TOKEN_SECRET=staging_access_token_secret_here
REFRESH_TOKEN_SECRET=staging_refresh_token_secret_here

# Rate Limiting
RATE_LIMIT_MAX=500
AUTH_RATE_LIMIT_MAX=3
FILE_UPLOAD_RATE_LIMIT_MAX=25

# Security
CORS_ORIGIN=https://staging.oxyhq.com
LOG_LEVEL=info

# File Upload
MAX_FILE_SIZE=5242880
UPLOAD_PATH=/app/uploads

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9090

# External Services
SMTP_HOST=smtp.staging.com
SMTP_PORT=587
SMTP_USER=staging@oxyhq.com
SMTP_PASS=staging_password
```

#### Production (.env.production)
```env
# Server Configuration
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Database
MONGODB_URI=mongodb://prod-db:27017/oxyhq_production

# Redis
REDIS_URL=redis://prod-redis:6379

# JWT Secrets (Use strong, unique secrets)
ACCESS_TOKEN_SECRET=your_production_access_token_secret_here
REFRESH_TOKEN_SECRET=your_production_refresh_token_secret_here

# Rate Limiting
RATE_LIMIT_MAX=1000
AUTH_RATE_LIMIT_MAX=5
FILE_UPLOAD_RATE_LIMIT_MAX=50

# Security
CORS_ORIGIN=https://oxyhq.com
LOG_LEVEL=warn

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_PATH=/app/uploads

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9090

# External Services
SMTP_HOST=smtp.production.com
SMTP_PORT=587
SMTP_USER=production@oxyhq.com
SMTP_PASS=production_password

# CDN
CDN_URL=https://cdn.oxyhq.com
CDN_KEY=your_cdn_key

# Backup
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION=30
```

## Docker Deployment

### Dockerfile

```dockerfile
# Multi-stage build for production
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/

# Build the application
WORKDIR /app/packages/api
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/packages/api/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/api/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy package files
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/packages/api/package*.json ./packages/api/

# Create uploads directory
RUN mkdir -p /app/uploads && chown nodejs:nodejs /app/uploads

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node dist/health-check.js

# Start application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
```

### Docker Compose

#### Development (docker-compose.dev.yml)
```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
      target: builder
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=development
      - MONGODB_URI=mongodb://mongo:27017/oxyhq_dev
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./packages/api/src:/app/packages/api/src
      - ./uploads:/app/uploads
    depends_on:
      - mongo
      - redis
    command: npm run dev

  mongo:
    image: mongo:5
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    environment:
      - MONGO_INITDB_DATABASE=oxyhq_dev

  redis:
    image: redis:6-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  mongo_data:
  redis_data:
```

#### Production (docker-compose.prod.yml)
```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
      target: production
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://mongo:27017/oxyhq_production
      - REDIS_URL=redis://redis:6379
    volumes:
      - uploads_data:/app/uploads
      - logs_data:/app/logs
    depends_on:
      - mongo
      - redis
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
        reservations:
          memory: 1G
          cpus: '0.5'

  mongo:
    image: mongo:5
    volumes:
      - mongo_data:/data/db
      - ./backups:/backups
    environment:
      - MONGO_INITDB_DATABASE=oxyhq_production
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'

  redis:
    image: redis:6-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.25'

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - api
    restart: unless-stopped

volumes:
  mongo_data:
  redis_data:
  uploads_data:
  logs_data:
```

### Nginx Configuration

```nginx
# nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream api_backend {
        server api:3001;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=1r/s;

    server {
        listen 80;
        server_name oxyhq.com www.oxyhq.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name oxyhq.com www.oxyhq.com;

        # SSL configuration
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # API routes
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            
            proxy_pass http://api_backend/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            
            # Timeouts
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # Authentication routes (stricter rate limiting)
        location /api/auth/ {
            limit_req zone=auth burst=5 nodelay;
            
            proxy_pass http://api_backend/auth/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        # Health check
        location /health {
            proxy_pass http://api_backend/health;
            access_log off;
        }

        # Static files
        location /static/ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            proxy_pass http://api_backend/static/;
        }
    }
}
```

## Kubernetes Deployment

### Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: oxyhq
```

### ConfigMap

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: oxyhq-config
  namespace: oxyhq
data:
  NODE_ENV: "production"
  PORT: "3001"
  HOST: "0.0.0.0"
  LOG_LEVEL: "warn"
  RATE_LIMIT_MAX: "1000"
  AUTH_RATE_LIMIT_MAX: "5"
  FILE_UPLOAD_RATE_LIMIT_MAX: "50"
  MAX_FILE_SIZE: "10485760"
  UPLOAD_PATH: "/app/uploads"
  ENABLE_METRICS: "true"
  METRICS_PORT: "9090"
```

### Secret

```yaml
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: oxyhq-secrets
  namespace: oxyhq
type: Opaque
data:
  ACCESS_TOKEN_SECRET: <base64-encoded-secret>
  REFRESH_TOKEN_SECRET: <base64-encoded-secret>
  MONGODB_URI: <base64-encoded-uri>
  REDIS_URL: <base64-encoded-url>
  SMTP_PASS: <base64-encoded-password>
```

### Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oxyhq-api
  namespace: oxyhq
spec:
  replicas: 3
  selector:
    matchLabels:
      app: oxyhq-api
  template:
    metadata:
      labels:
        app: oxyhq-api
    spec:
      containers:
      - name: api
        image: oxyhq/api:latest
        ports:
        - containerPort: 3001
        envFrom:
        - configMapRef:
            name: oxyhq-config
        - secretRef:
            name: oxyhq-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
        volumeMounts:
        - name: uploads
          mountPath: /app/uploads
        - name: logs
          mountPath: /app/logs
      volumes:
      - name: uploads
        persistentVolumeClaim:
          claimName: oxyhq-uploads-pvc
      - name: logs
        persistentVolumeClaim:
          claimName: oxyhq-logs-pvc
```

### Service

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: oxyhq-api-service
  namespace: oxyhq
spec:
  selector:
    app: oxyhq-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3001
  type: ClusterIP
```

### Ingress

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: oxyhq-ingress
  namespace: oxyhq
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "1000"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
spec:
  tls:
  - hosts:
    - api.oxyhq.com
    secretName: oxyhq-tls
  rules:
  - host: api.oxyhq.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: oxyhq-api-service
            port:
              number: 80
```

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
    
    - name: Run linting
      run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Docker Buildx
      uses: docker/setup-buildx-action@v2
    
    - name: Login to Docker Hub
      uses: docker/login-action@v2
      with:
        username: ${{ secrets.DOCKER_USERNAME }}
        password: ${{ secrets.DOCKER_PASSWORD }}
    
    - name: Build and push Docker image
      uses: docker/build-push-action@v4
      with:
        context: .
        file: packages/api/Dockerfile
        push: true
        tags: oxyhq/api:latest,oxhq/api:${{ github.sha }}
        cache-from: type=gha
        cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup kubectl
      uses: azure/setup-kubectl@v3
    
    - name: Configure kubectl
      run: |
        echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > kubeconfig
        export KUBECONFIG=kubeconfig
    
    - name: Deploy to Kubernetes
      run: |
        kubectl set image deployment/oxhq-api api=oxhq/api:${{ github.sha }} -n oxyhq
        kubectl rollout status deployment/oxhq-api -n oxyhq
```

## Monitoring & Logging

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'oxhq-api'
    static_configs:
      - targets: ['oxhq-api-service:3001']
    metrics_path: '/metrics'
    scrape_interval: 5s
```

### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "OxyHQ API Metrics",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{method}} {{path}}"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])",
            "legendFormat": "5xx errors"
          }
        ]
      }
    ]
  }
}
```

### Log Aggregation

```yaml
# fluentd-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
  namespace: oxyhq
data:
  fluent.conf: |
    <source>
      @type tail
      path /var/log/containers/oxhq-api-*.log
      pos_file /var/log/oxhq-api.log.pos
      tag oxhq.api
      read_from_head true
      <parse>
        @type json
        time_key time
        time_format %Y-%m-%dT%H:%M:%S.%NZ
      </parse>
    </source>

    <match oxhq.api>
      @type elasticsearch
      host elasticsearch
      port 9200
      logstash_format true
      logstash_prefix oxhq-api
      <buffer>
        @type file
        path /var/log/fluentd-buffers/kubernetes.system.buffer
        flush_mode interval
        retry_type exponential_backoff
        flush_interval 5s
        retry_forever false
        retry_max_interval 30
        chunk_limit_size 2M
        queue_limit_length 8
        overflow_action block
      </buffer>
    </match>
```

## Backup Strategy

### Database Backup

```bash
#!/bin/bash
# backup.sh

# Configuration
BACKUP_DIR="/backups"
MONGODB_URI="mongodb://localhost:27017/oxyhq_production"
RETENTION_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Generate backup filename
BACKUP_FILE="oxhq_backup_$(date +%Y%m%d_%H%M%S).gz"

# Create backup
mongodump --uri="$MONGODB_URI" --gzip --archive="$BACKUP_DIR/$BACKUP_FILE"

# Remove old backups
find $BACKUP_DIR -name "oxhq_backup_*.gz" -mtime +$RETENTION_DAYS -delete

# Upload to cloud storage (optional)
# aws s3 cp "$BACKUP_DIR/$BACKUP_FILE" s3://oxhq-backups/
```

### Cron Job

```yaml
# backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: oxhq-backup
  namespace: oxyhq
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: mongo:5
            command:
            - /bin/bash
            - -c
            - |
              mongodump --uri="$MONGODB_URI" --gzip --archive="/backups/oxhq_backup_$(date +%Y%m%d_%H%M%S).gz"
              find /backups -name "oxhq_backup_*.gz" -mtime +30 -delete
            env:
            - name: MONGODB_URI
              valueFrom:
                secretKeyRef:
                  name: oxyhq-secrets
                  key: MONGODB_URI
            volumeMounts:
            - name: backups
              mountPath: /backups
          volumes:
          - name: backups
            persistentVolumeClaim:
              claimName: oxyhq-backups-pvc
          restartPolicy: OnFailure
```

## Security Checklist

- [ ] SSL/TLS certificates configured
- [ ] Environment variables secured
- [ ] Database access restricted
- [ ] Firewall rules configured
- [ ] Rate limiting enabled
- [ ] Security headers set
- [ ] Regular security updates
- [ ] Backup encryption enabled
- [ ] Access logging enabled
- [ ] Monitoring alerts configured

## Performance Checklist

- [ ] Load balancer configured
- [ ] CDN setup for static assets
- [ ] Database indexes optimized
- [ ] Redis caching enabled
- [ ] Compression enabled
- [ ] Monitoring dashboards configured
- [ ] Performance testing completed
- [ ] Auto-scaling configured
- [ ] Resource limits set
- [ ] Health checks implemented

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Check for memory leaks
   - Increase memory limits
   - Optimize database queries

2. **Slow Response Times**
   - Check database performance
   - Verify cache hit rates
   - Monitor network latency

3. **Connection Errors**
   - Check database connectivity
   - Verify Redis connection
   - Review firewall rules

4. **SSL Issues**
   - Verify certificate validity
   - Check certificate chain
   - Review SSL configuration

### Debug Commands

```bash
# Check container logs
docker logs oxyhq-api

# Check Kubernetes logs
kubectl logs -f deployment/oxhq-api -n oxyhq

# Check resource usage
kubectl top pods -n oxyhq

# Check service endpoints
kubectl get endpoints -n oxyhq

# Test database connection
kubectl exec -it deployment/oxhq-api -n oxyhq -- mongosh $MONGODB_URI

# Check Redis connection
kubectl exec -it deployment/oxhq-api -n oxyhq -- redis-cli -u $REDIS_URL ping
``` 