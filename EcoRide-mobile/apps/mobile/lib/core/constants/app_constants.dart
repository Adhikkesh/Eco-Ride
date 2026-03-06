/// Eco-Ride App Constants
/// Centralized configuration for colors, strings, and API endpoints.
library;

import 'package:flutter/material.dart';

// =============================================================================
// COLOR PALETTE - Eco-Ride Theme
// =============================================================================

class AppColors {
  AppColors._();

  // Primary - Deep Emerald
  static const Color primary = Color(0xFF0D6B3B);
  static const Color primaryLight = Color(0xFF10B981);
  static const Color primaryDark = Color(0xFF14532D);

  // Secondary - Mint & Teal
  static const Color secondary = Color(0xFF6EE7B7);
  static const Color accent = Color(0xFFA3E635);
  static const Color teal = Color(0xFF5EEAD4);
  static const Color mint = Color(0xFFA7F3D0);

  // Neutrals
  static const Color white = Color(0xFFFFFFFF);
  static const Color offWhite = Color(0xFFF8FAFC);
  static const Color lightGrey = Color(0xFFE2E8F0);
  static const Color grey = Color(0xFF94A3B8);
  static const Color darkGrey = Color(0xFF475569);

  // Text
  static const Color textPrimary = Color(0xFF1E293B);
  static const Color textSecondary = Color(0xFF64748B);
  static const Color textLight = Color(0xFFFFFFFF);

  // Status
  static const Color success = Color(0xFF10B981);
  static const Color error = Color(0xFFEF4444);
  static const Color warning = Color(0xFFF59E0B);
  static const Color info = Color(0xFF3B82F6);

  // Background
  static const Color background = Color(0xFFF8FAFC);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color cardBackground = Color(0xFFFFFFFF);

  // Glass
  static const Color glassBg = Color(0xCCFFFFFF); // 80% white
  static const Color glassBorder = Color(0x33FFFFFF); // 20% white
}

// =============================================================================
// GRADIENTS
// =============================================================================

class AppGradients {
  AppGradients._();

  static const LinearGradient primaryButton = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF10B981), Color(0xFF0D6B3B)],
  );

  static const LinearGradient emeraldGlow = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF0D6B3B), Color(0xFF14532D)],
  );

  static const LinearGradient mintFade = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFA7F3D0), Color(0xFF6EE7B7)],
  );

  static const LinearGradient glassFrost = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xBBFFFFFF), Color(0x88FFFFFF)],
  );

  static const LinearGradient darkOverlay = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0x00000000), Color(0x66000000)],
  );

  static const LinearGradient accentPop = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFA3E635), Color(0xFF10B981)],
  );
}

// =============================================================================
// SHADOWS
// =============================================================================

class AppShadows {
  AppShadows._();

  static List<BoxShadow> get soft => [
    BoxShadow(
      color: const Color(0xFF0D6B3B).withValues(alpha: 0.08),
      blurRadius: 12,
      offset: const Offset(0, 4),
    ),
  ];

  static List<BoxShadow> get medium => [
    BoxShadow(
      color: const Color(0xFF0D6B3B).withValues(alpha: 0.12),
      blurRadius: 20,
      offset: const Offset(0, 8),
    ),
  ];

  static List<BoxShadow> get glow => [
    BoxShadow(
      color: const Color(0xFF10B981).withValues(alpha: 0.3),
      blurRadius: 24,
      offset: const Offset(0, 8),
    ),
  ];

  static List<BoxShadow> get card => [
    BoxShadow(
      color: Colors.black.withValues(alpha: 0.06),
      blurRadius: 16,
      offset: const Offset(0, 4),
    ),
  ];
}

// =============================================================================
// USER ROLES
// =============================================================================

enum UserRole {
  rider('rider', 'Rider', Icons.person),
  driver('driver', 'Driver', Icons.drive_eta),
  admin('admin', 'Admin', Icons.admin_panel_settings);

  const UserRole(this.value, this.displayName, this.icon);

  final String value;
  final String displayName;
  final IconData icon;

  static UserRole fromString(String value) {
    return UserRole.values.firstWhere(
      (role) => role.value == value.toLowerCase(),
      orElse: () => UserRole.rider,
    );
  }
}

// =============================================================================
// APP STRINGS
// =============================================================================

class AppStrings {
  AppStrings._();

  static const String appName = 'Eco-Ride';
  static const String tagline = 'Ride Green, Ride Clean';

  // Auth
  static const String signIn = 'Sign In';
  static const String signUp = 'Sign Up';
  static const String email = 'Email';
  static const String password = 'Password';
  static const String confirmPassword = 'Confirm Password';
  static const String fullName = 'Full Name';
  static const String phoneNumber = 'Phone Number';
  static const String selectRole = 'Select Role';
  static const String forgotPassword = 'Forgot Password?';
  static const String noAccount = "Don't have an account?";
  static const String haveAccount = 'Already have an account?';
  static const String createAccount = 'Create Account';
  static const String welcomeBack = 'Welcome Back!';
  static const String getStarted = 'Get Started';

  // Validation
  static const String emailRequired = 'Email is required';
  static const String invalidEmail = 'Please enter a valid email';
  static const String passwordRequired = 'Password is required';
  static const String passwordTooShort = 'Password must be at least 6 characters';
  static const String passwordsDoNotMatch = 'Passwords do not match';
  static const String nameRequired = 'Name is required';
  static const String phoneRequired = 'Phone number is required';
  static const String roleRequired = 'Please select a role';
}

// =============================================================================
// API CONFIGURATION
// =============================================================================

class ApiConfig {
  ApiConfig._();

  // Backend URL - Use your machine's LAN IP for physical device testing
  // Change to 'http://localhost:3001' for simulator, or your deployed URL for production
  static const String baseUrl = 'http://10.12.226.39:3001';

  // Endpoints
  static const String verifyToken = '/api/auth/verify';
  static const String createUser = '/api/v1/user';
  static const String estimateRide = '/api/v1/ride/estimate';
  static const String requestRide = '/api/v1/ride/request';
  static const String acceptRide = '/api/v1/ride/accept';
  static const String declineRide = '/api/v1/ride/decline';
  static const String arriveAtPickup = '/api/v1/ride/arrive';
  static const String startRide = '/api/v1/ride/start';
  static const String completeRide = '/api/v1/ride/complete';
  static const String cancelRide = '/api/v1/ride/cancel';
  static const String activeRide = '/api/v1/ride/active';
  static const String getOtp = '/api/v1/ride/otp';

  // Payment
  static const String createPaymentIntent = '/api/v1/payment/create-intent';
  static const String confirmPayment = '/api/v1/ride/confirm-payment';
  
  // Google Maps API
  static const String googleMapsApiKey = 'AIzaSyD5ucfXDiTYX9T7Nirz_de1vz2qgwbNJXo';

  // Stripe
  static const String stripePublishableKey = 'pk_test_51SvYXY48on6RPqrGxOElRVwHiZLMQcSQo8UAWKYw3au5cFzc0xn929H2DJO9eie73pLzGpRrxaEFT1CcKZ6ZNrEA00q1Pb35Ps';
}

// =============================================================================
// DIMENSIONS & STYLING
// =============================================================================

class AppDimens {
  AppDimens._();

  // Padding
  static const double paddingXS = 4.0;
  static const double paddingSM = 8.0;
  static const double paddingMD = 16.0;
  static const double paddingLG = 24.0;
  static const double paddingXL = 32.0;

  // Border Radius
  static const double radiusSM = 8.0;
  static const double radiusMD = 12.0;
  static const double radiusLG = 16.0;
  static const double radiusXL = 24.0;
  static const double radiusFull = 100.0;

  // Icon sizes
  static const double iconSM = 16.0;
  static const double iconMD = 24.0;
  static const double iconLG = 32.0;
  static const double iconXL = 48.0;

  // Button heights
  static const double buttonHeight = 56.0;
  static const double inputHeight = 56.0;
}
