# oxy.so Reverse Proxy

Simple reverse proxy that sits in front of Framer to serve the FedCM well-known file.

## Purpose

FedCM requires the `/.well-known/web-identity` file to be served from the eTLD+1 domain (`oxy.so`), not the subdomain (`auth.oxy.so`). Since oxy.so is hosted on Framer which doesn't support custom well-known files, this proxy:

1. Serves `/.well-known/web-identity` with FedCM provider configuration
2. Proxies all other requests to Framer

## Deployment

### DigitalOcean App Platform

1. Push to GitHub
2. Create new App in DO App Platform
3. Select this repo, set source directory to `packages/oxy-proxy`
4. Update DNS for `oxy.so` to point to the DO app

### DNS Configuration

After deploying, update `oxy.so` DNS:
- Remove existing A/CNAME records pointing to Framer
- Add CNAME record pointing to the DO app URL (e.g., `oxy-proxy-xxxxx.ondigitalocean.app`)

Or if using Cloudflare:
- Keep Cloudflare proxy enabled
- Point to the DO app

## Local Testing

```bash
npm install
npm start
# Visit http://localhost:8080/.well-known/web-identity
```
