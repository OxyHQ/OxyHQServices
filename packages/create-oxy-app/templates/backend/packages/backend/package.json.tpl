{
  "name": "@{{APP_SLUG}}/backend",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "main": "dist/server.js",
  "scripts": {
    "dev": "bun --watch server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "bun dist/server.js",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@{{APP_SLUG}}/shared-types": "workspace:*",
    "@oxyhq/core": "{{v.oxyCore}}",
    "dotenv": "{{v.dotenv}}",
    "express": "{{v.express}}",
    "mongoose": "{{v.mongoose}}",
    "socket.io": "{{v.socketIo}}"
  },
  "devDependencies": {
    "@types/express": "{{v.expressTypes}}",
    "@types/node": "{{v.nodeTypes}}",
    "typescript": "{{v.typescript}}"
  }
}
