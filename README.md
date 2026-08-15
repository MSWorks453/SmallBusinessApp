# Small Business App

A cross-platform React Native application built with Expo that supports iOS, Android, and Web platforms.

## Tech Stack

- **React Native**: 0.86.2
- **Expo**: 57.0.13
- **React**: 19.2.3
- **Platform Support**: iOS, Android, Web (built-in Expo web support)

## Prerequisites

- Node.js (v20.19.4 or higher recommended)
- npm or yarn package manager
- For iOS: Xcode (macOS only)
- For Android: Android Studio with Android SDK
- For Web: Modern web browser

## Installation

1. Install dependencies:
```bash
npm install
```

## Running the App

### Start Development Server
```bash
npm start
```

### Platform-Specific Commands

**iOS:**
```bash
npm run ios
```
*Requires macOS and Xcode*

**Android:**
```bash
npm run android
```
*Requires Android Studio and emulator or connected device*

**Web:**
```bash
npm run web
```
*Opens in your default browser*

## Project Structure

```
SmallBusinessApp/
├── App.js              # Main application component
├── app.json            # Expo configuration
├── package.json        # Dependencies and scripts
├── assets/             # Images, icons, fonts
└── index.js            # Entry point
```

## Configuration

### iOS Configuration
- Bundle Identifier: `com.smallbusinessapp.app`
- Supports iPhone and iPad

### Android Configuration
- Package Name: `com.smallbusinessapp.app`
- Adaptive icons configured

### Web Configuration
- Metro bundler for web compilation
- Responsive design support

## Development

The app is configured to run on all three platforms with a single codebase. Platform-specific code can be implemented using the `Platform` module from React Native.

Example:
```javascript
import { Platform } from 'react-native';

const platformSpecificStyle = Platform.select({
  ios: { paddingTop: 20 },
  android: { paddingTop: 10 },
  web: { paddingTop: 0 },
});
```

## Building for Production

### iOS
```bash
eas build --platform ios
```

### Android
```bash
eas build --platform android
```

### Web
```bash
npm run web
```
Then deploy the `web-build` directory to your hosting service.

## Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [Expo v57.0.0 Docs](https://docs.expo.dev/versions/v57.0.0/)

## License

This project is licensed under the MIT License.
