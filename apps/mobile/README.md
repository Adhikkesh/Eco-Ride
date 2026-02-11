# Eco-Ride Mobile App

Flutter mobile application for Eco-Ride - sustainable ride-sharing platform.

## Prerequisites

- Flutter SDK 3.9.0 or higher
- Xcode (for iOS development)
- Android Studio (for Android development)
- Firebase project configured

## Firebase Setup

### 1. Add Flutter App to Firebase

```bash
# Install FlutterFire CLI (if not installed)
dart pub global activate flutterfire_cli

# Configure Firebase for this project
flutterfire configure --project=eco-ride-07
```

Or manually:
1. Go to [Firebase Console](https://console.firebase.google.com/project/eco-ride-07/settings/general)
2. Click "Add app" → Flutter
3. Follow the setup wizard

### 2. Download Config Files

**Android:**
- Download `google-services.json`
- Place in `android/app/google-services.json`

**iOS:**
- Download `GoogleService-Info.plist`
- Place in `ios/Runner/GoogleService-Info.plist`

### 3. Enable Authentication

Ensure Email/Password authentication is enabled in Firebase Console → Authentication → Sign-in method.

## Development Commands

```bash
# Navigate to mobile app
cd apps/mobile

# Install dependencies
flutter pub get

# Run on connected device/simulator
flutter run

# Run on specific platform
flutter run -d ios
flutter run -d android

# Hot reload (while running): Press 'r'
# Hot restart (while running): Press 'R'
# Quit: Press 'q'
```

## Build Commands

```bash
# Analyze code
flutter analyze

# Run tests
flutter test

# Build APK (Android)
flutter build apk --release

# Build App Bundle (Android - for Play Store)
flutter build appbundle --release

# Build iOS (requires macOS)
flutter build ios --release
```

## Project Structure

```
lib/
├── main.dart                       # Entry point, Firebase init, theme
├── core/
│   ├── constants/
│   │   └── app_constants.dart      # Colors, strings, dimensions
│   ├── models/
│   │   └── user_model.dart         # User data model
│   └── services/
│       └── auth_service.dart       # Firebase Auth + Firestore
└── features/
    └── auth/
        ├── screens/
        │   ├── login_screen.dart   # Sign In UI
        │   └── signup_screen.dart  # Sign Up UI
        └── widgets/
            └── auth_text_field.dart # Reusable input field
```

## Architecture

- **Feature-first organization**: Code organized by feature (auth, rides, profile)
- **Service layer**: Business logic separated from UI
- **Model classes**: Clean data models with serialization

## Theme

The app uses the Eco-Ride brand identity:
- **Primary**: Forest Green (#2E7D32)
- **Typography**: Poppins (via Google Fonts)
- **Style**: Clean, modern, accessible
