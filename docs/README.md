# OxyHQ Services Documentation

Complete documentation for the Oxy ecosystem services and authentication.

## 📚 Documentation Index

### Getting Started
- **[Main README](../README.md)** - Project overview and quick start

### Authentication & Cross-Platform
- **[Cross-Domain Authentication](CROSS_DOMAIN_AUTH.md)** - Web SSO using FedCM, popup, and redirect flows
- **[Expo 54 Universal Guide](EXPO_54_GUIDE.md)** - Building universal apps (iOS, Android, Web) with Expo 54

### Typography & Design
- **[Font Migration Guide](FONT_MIGRATION.md)** - Phudu → Inter migration complete summary
- **[Services Typography](../packages/services/FONTS.md)** - Complete Inter font usage guide
- **[Migration Checklist](../packages/services/MIGRATION_CHECKLIST.md)** - Step-by-step migration for apps

### Package Documentation
- **[Services Package](../packages/services/README.md)** - Main @oxyhq/services package docs
- **[Services Changelog](../packages/services/CHANGELOG.md)** - Version history and breaking changes

## 🎯 Quick Links by Use Case

### Building a New App
1. Start with [Main README](../README.md)
2. Follow [Expo 54 Guide](EXPO_54_GUIDE.md) for universal apps
3. Check [Services Typography](../packages/services/FONTS.md) for fonts

### Adding SSO to Existing Web App
1. Read [Cross-Domain Auth](CROSS_DOMAIN_AUTH.md)
2. Install `@oxyhq/services`
3. Wrap app with `<WebOxyProvider>`

### Migrating Fonts to Inter
1. Follow [Migration Checklist](../packages/services/MIGRATION_CHECKLIST.md)
2. Reference [Font Migration](FONT_MIGRATION.md) for context
3. See [Typography Guide](../packages/services/FONTS.md) for usage

## 📖 Documentation Structure

```
OxyHQServices/
├── README.md                          # Main project readme
├── docs/                              # 📁 All guides and documentation
│   ├── README.md                      # This file (documentation index)
│   ├── CROSS_DOMAIN_AUTH.md          # Cross-domain SSO guide
│   ├── EXPO_54_GUIDE.md              # Expo 54 universal app guide
│   └── FONT_MIGRATION.md             # Font migration summary
├── packages/
│   └── services/                      # Main services package
│       ├── README.md                  # Package documentation
│       ├── FONTS.md                   # Typography guide
│       ├── CHANGELOG.md               # Version history
│       └── MIGRATION_CHECKLIST.md    # Step-by-step migration
└── packages/api/                      # API server (separate docs)
```

## 🤝 Contributing

See individual package READMEs for contribution guidelines.

## 📄 License

MIT © OxyHQ
