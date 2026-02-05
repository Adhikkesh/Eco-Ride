/// Eco-Ride App Constants
/// Centralized configuration for colors, strings, and API endpoints.
library;

import 'package:flutter/material.dart';

// =============================================================================
// COLOR PALETTE - Eco-Ride Theme
// =============================================================================

class AppColors {
  AppColors._();

  // Primary - Forest Green
  static const Color primary = Color(0xFF2E7D32);
  static const Color primaryLight = Color(0xFF4CAF50);
  static const Color primaryDark = Color(0xFF1B5E20);

  // Secondary
  static const Color secondary = Color(0xFF81C784);
  static const Color accent = Color(0xFF00E676);

  // Neutrals
  static const Color white = Color(0xFFFFFFFF);
  static const Color offWhite = Color(0xFFF5F5F5);
  static const Color lightGrey = Color(0xFFE0E0E0);
  static const Color grey = Color(0xFF9E9E9E);
  static const Color darkGrey = Color(0xFF424242);

  // Text
  static const Color textPrimary = Color(0xFF212121);
  static const Color textSecondary = Color(0xFF757575);
  static const Color textLight = Color(0xFFFFFFFF);

  // Status
  static const Color success = Color(0xFF4CAF50);
  static const Color error = Color(0xFFE53935);
  static const Color warning = Color(0xFFFFC107);
  static const Color info = Color(0xFF2196F3);

  // Background
  static const Color background = Color(0xFFFAFAFA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color cardBackground = Color(0xFFFFFFFF);
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

  // Backend URL - Update this for production
  static const String baseUrl = 'http://localhost:3001';

  // Endpoints
  static const String verifyToken = '/api/auth/verify';
  static const String createUser = '/api/v1/user';
  static const String estimateRide = '/api/v1/ride/estimate';
  static const String requestRide = '/api/v1/ride/request';
  
  // Google Maps API
  static const String googleMapsApiKey = 'AIzaSyD5ucfXDiTYX9T7Nirz_de1vz2qgwbNJXo';
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
