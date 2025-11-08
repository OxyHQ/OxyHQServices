/**
 * Simple webhook development server for testing webhook notifications
 * Run this locally to receive and inspect webhook payloads from Oxy
 * 
 * Usage: node webhook-dev-server.js [port]
 * Example: node webhook-dev-server.js 4000
 */

const http = require('http');

const PORT = process.argv[2] || 4000;

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      console.log('\n' + '='.repeat(80));
      console.log('📨 Webhook Received at:', new Date().toISOString());
      console.log('='.repeat(80));
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      console.log('-'.repeat(80));
      
      try {
        const payload = JSON.parse(body);
        console.log('Payload:', JSON.stringify(payload, null, 2));
        
        if (payload.event) {
          console.log('\n🎯 Event Type:', payload.event);
          console.log('📁 File ID:', payload.fileId);
          if (payload.visibility) console.log('👁️  Visibility:', payload.visibility);
          if (payload.link) console.log('🔗 Link:', payload.link);
        }
      } catch (e) {
        console.log('Body (raw):', body);
      }
      
      console.log('='.repeat(80) + '\n');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Webhook Development Server - POST webhooks here');
  }
});

server.listen(PORT, () => {
  console.log('\n' + '🎣 Webhook Development Server'.padEnd(80, ' '));
  console.log('='.repeat(80));
  console.log(`✅ Server running on: http://localhost:${PORT}`);
  console.log(`📮 Use this URL in your app: http://localhost:${PORT}/webhook`);
  console.log('='.repeat(80));
  console.log('💡 Tip: Use ngrok to expose this server for remote testing:');
  console.log(`   ngrok http ${PORT}`);
  console.log('='.repeat(80) + '\n');
  console.log('Waiting for webhooks...\n');
});
