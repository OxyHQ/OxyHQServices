# Zero-Config OxyHQ Services Example

This example demonstrates the zero-config integration between frontend and backend using OxyHQ Services.

## Quick Start

1. **Start the Oxy API server** (in a separate terminal):
   ```bash
   cd ../../packages/api
   npm run dev
   ```

2. **Start the backend** (in a separate terminal):
   ```bash
   cd backend
   npm install
   npm start
   ```

3. **Start the frontend** (in a separate terminal):
   ```bash
   cd frontend
   npm install
   npm start
   ```

4. **Open http://localhost:3000** in your browser

## Features Demonstrated

- **Zero-config frontend**: One provider wrapper, one hook
- **Zero-config backend**: One middleware line provides automatic `req.user`
- **Automatic token management**: No manual token handling required
- **Cross-platform**: Same API works for web and mobile
- **Error handling**: Built-in authentication error handling

## File Structure

```
├── frontend/
│   ├── src/
│   │   ├── App.js           # Zero-config provider setup
│   │   ├── Dashboard.js     # Authentication hook usage
│   │   └── index.js         # React entry point
│   └── package.json
├── backend/
│   ├── server.js            # Zero-config middleware setup
│   └── package.json
└── README.md
```

## How It Works

### Frontend (2 lines of code)
1. Wrap app with `<OxyZeroConfigProvider>`
2. Use `useOxyZeroConfig()` hook anywhere

### Backend (1 line of code)
1. Add `app.use('/api', createOxyAuth())` middleware
2. Access `req.user` in any route handler

No configuration files, no manual token management, no complex setup!