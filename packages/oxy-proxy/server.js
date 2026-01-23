const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 8080;

// The Framer site URL (oxy.so is hosted on Framer)
const FRAMER_TARGET = 'https://oxy.framer.website';

// FedCM well-known file - must be served from eTLD+1 (oxy.so)
// This authorizes auth.oxy.so as a FedCM identity provider
const WELL_KNOWN_WEB_IDENTITY = {
  provider_urls: ['https://auth.oxy.so/fedcm.json']
};

// Serve /.well-known/web-identity for FedCM
app.get('/.well-known/web-identity', (req, res) => {
  res.set({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=3600'
  });
  res.json(WELL_KNOWN_WEB_IDENTITY);
});

// Handle OPTIONS for well-known (CORS preflight)
app.options('/.well-known/web-identity', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400'
  });
  res.status(204).end();
});

// Health check endpoint for DO App Platform
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Proxy everything else to Framer
app.use('/', createProxyMiddleware({
  target: FRAMER_TARGET,
  changeOrigin: true,
  // Preserve the original host header for Framer routing
  headers: {
    'X-Forwarded-Host': 'oxy.so'
  },
  // Handle WebSocket connections if needed
  ws: true,
  // Don't verify SSL (Framer handles its own SSL)
  secure: true,
  // Log proxy events in development
  logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  // Handle proxy errors gracefully
  onError: (err, req, res) => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Bad Gateway', message: 'Unable to reach upstream server' });
  }
}));

app.listen(PORT, () => {
  console.log(`oxy.so proxy server running on port ${PORT}`);
  console.log(`Proxying to Framer: ${FRAMER_TARGET}`);
  console.log(`FedCM well-known served at: /.well-known/web-identity`);
});
