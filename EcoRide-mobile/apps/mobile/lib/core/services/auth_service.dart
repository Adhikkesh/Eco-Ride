import 'dart:io';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;
import '../constants/app_constants.dart';
import '../models/user_model.dart';

/// Custom exception for authentication errors with user-friendly messages
class AuthException implements Exception {
  final String message;
  final String? code;

  const AuthException(this.message, {this.code});

  @override
  String toString() => message;

  /// Convert Firebase exceptions to user-friendly messages
  factory AuthException.fromFirebase(FirebaseAuthException e) {
    switch (e.code) {
      case 'email-already-in-use':
        return const AuthException(
          'This email is already registered. Please sign in instead.',
          code: 'email-already-in-use',
        );
      case 'invalid-email':
        return const AuthException(
          'Please enter a valid email address.',
          code: 'invalid-email',
        );
      case 'weak-password':
        return const AuthException(
          'Password is too weak. Please use at least 6 characters.',
          code: 'weak-password',
        );
      case 'user-not-found':
        return const AuthException(
          'No account found with this email. Please sign up first.',
          code: 'user-not-found',
        );
      case 'wrong-password':
        return const AuthException(
          'Incorrect password. Please try again.',
          code: 'wrong-password',
        );
      case 'invalid-credential':
        return const AuthException(
          'Invalid email or password. Please check your credentials.',
          code: 'invalid-credential',
        );
      case 'user-disabled':
        return const AuthException(
          'This account has been disabled. Please contact support.',
          code: 'user-disabled',
        );
      case 'too-many-requests':
        return const AuthException(
          'Too many failed attempts. Please try again later.',
          code: 'too-many-requests',
        );
      case 'network-request-failed':
        return const AuthException(
          'Network error. Please check your connection.',
          code: 'network-request-failed',
        );
      default:
        return AuthException(
          e.message ?? 'An unexpected error occurred. Please try again.',
          code: e.code,
        );
    }
  }
}

/// Authentication Service
/// Singleton pattern for global access
class AuthService {
  // Private constructor
  AuthService._();

  // Singleton instance
  static final AuthService _instance = AuthService._();
  static AuthService get instance => _instance;

  // Firebase instances
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;
  
  // Backend URL (Use 10.0.2.2 for Android Emulator, localhost for iOS Simulator/Web)
  // TODO: Use better config management
  // Backend URL (Use 10.0.2.2 for Android Emulator, localhost for iOS Simulator/Web)
  // TODO: Use better config management
  String get _backendUrl {
     if (kIsWeb) return 'http://localhost:3001/api/v1';
     if (Platform.isAndroid) return 'http://10.0.2.2:3001/api/v1';
     return 'http://localhost:3001/api/v1';
  }

  // Collection reference
  CollectionReference<Map<String, dynamic>> get _usersCollection =>
      _firestore.collection('users');

  // ==========================================================================
  // AUTH STATE
  // ==========================================================================

  /// Stream of authentication state changes
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// Current Firebase user (null if not signed in)
  User? get currentUser => _auth.currentUser;

  /// Check if user is signed in
  bool get isSignedIn => currentUser != null;

  // ==========================================================================
  // SIGN UP
  // ==========================================================================

  /// Sign up a new user with email and password
  /// Creates both Firebase Auth user and Firestore user document
  ///
  /// [email] - User's email address
  /// [password] - User's password (minimum 6 characters)
  /// [name] - User's full name
  /// [phoneNumber] - User's phone number
  /// [role] - User's role (rider, driver, or admin)
  ///
  /// Returns the created [UserModel] on success
  /// Throws [AuthException] on failure
  Future<UserModel> signUp({
    required String email,
    required String password,
    required String name,
    required String phoneNumber,
    required UserRole role,
  }) async {
    try {
      // 1. Create Firebase Auth user
      final userCredential = await _auth.createUserWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );

      final firebaseUser = userCredential.user;
      if (firebaseUser == null) {
        throw const AuthException('Failed to create user account.');
      }

      // 2. Update display name
      await firebaseUser.updateDisplayName(name.trim());

      // 3. Create Firestore user document
      final userModel = UserModel(
        uid: firebaseUser.uid,
        email: email.trim(),
        name: name.trim(),
        phoneNumber: phoneNumber.trim(),
        role: role,
        greenPoints: 0,
        trustScore: 0.0,
        createdAt: DateTime.now(),
      );

      await _usersCollection.doc(firebaseUser.uid).set(userModel.toFirestore());

      return userModel;
    } on FirebaseAuthException catch (e) {
      throw AuthException.fromFirebase(e);
    } catch (e) {
      if (e is AuthException) rethrow;
      throw AuthException('Failed to create account: ${e.toString()}');
    }
  }
  /// Update user's role in Firestore
  Future<void> updateUserRole(String uid, UserRole role) async {
    try {
      debugPrint('AuthService: Updating role to ${role.value} for $uid');
      await _usersCollection.doc(uid).update({
        'role': role.value,
        'last_updated': FieldValue.serverTimestamp(),
      }).timeout(const Duration(seconds: 5));
      debugPrint('AuthService: Role update SUCCESS');
    } catch (e) {
      debugPrint('AuthService: Role update FAILED: $e');
      throw AuthException('Failed to update account role: ${e.toString()}');
    }
  }

  // ==========================================================================
  // SIGN IN
  // ==========================================================================

  /// Sign in with email and password
  ///
  /// [email] - User's email address
  /// [password] - User's password
  ///
  /// Returns the [UserModel] from Firestore on success
  /// Throws [AuthException] on failure
  Future<void> signIn({
    required String email,
    required String password,
  }) async {
    try {
      final cleanEmail = email.trim();
      debugPrint('AuthService: >>> SIGN-IN START for $cleanEmail');
      
      debugPrint('AuthService: Calling Firebase signInWithEmailAndPassword...');
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: cleanEmail,
        password: password,
      ).timeout(const Duration(seconds: 15), onTimeout: () {
        debugPrint('AuthService: !!! Firebase sign-in TIMED OUT (15s)');
        throw const AuthException('Sign-in timed out. Please check your internet or try again.');
      });

      final firebaseUser = userCredential.user;
      if (firebaseUser == null) {
        debugPrint('AuthService: !!! Firebase sign-in returned null user');
        throw const AuthException('Failed to sign in: User is null.');
      }

      debugPrint('AuthService: Firebase sign-in SUCCESS. UID: ${firebaseUser.uid}');

      // Update last login timestamp in background
      debugPrint('AuthService: Triggering async last_login update...');
      _usersCollection.doc(firebaseUser.uid).update({
        'last_login': FieldValue.serverTimestamp(),
      }).timeout(const Duration(seconds: 5)).then((_) {
        debugPrint('AuthService: Async last_login update SUCCESS');
      }).catchError((e) {
        debugPrint('AuthService: Async last_login update FAILED (ignoring): $e');
      });
      
      debugPrint('AuthService: <<< SIGN-IN COMPLETE');
    } on FirebaseAuthException catch (e) {
      debugPrint('AuthService: !!! FirebaseAuthException: code=${e.code}, message=${e.message}');
      throw AuthException.fromFirebase(e);
    } catch (e) {
      debugPrint('AuthService: !!! UNEXPECTED ERROR during sign-in: $e');
      if (e is AuthException) rethrow;
      throw AuthException('Failed to sign in: ${e.toString()}');
    }
  }

  // ==========================================================================
  // GOOGLE SIGN IN
  // ==========================================================================

  /// Google Sign-In instance
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: ['email', 'profile'],
  );

  /// Sign in with Google OAuth
  /// Creates Firestore user document if first time user
  ///
  /// [defaultRole] - Role to assign if user is new (default: rider)
  ///
  /// Returns the [UserModel] on success
  /// Throws [AuthException] on failure
  Future<UserModel?> signInWithGoogle({UserRole defaultRole = UserRole.rider}) async {
    try {
      // 1. Trigger the Google Sign-In flow
      final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
      
      if (googleUser == null) {
        // User cancelled the sign-in
        return null;
      }

      // 2. Obtain the auth details from the request
      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;

      // 3. Create a new credential
      final credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      // 4. Sign in to Firebase with the credential
      final userCredential = await _auth.signInWithCredential(credential);
      final firebaseUser = userCredential.user;

      if (firebaseUser == null) {
        throw const AuthException('Failed to sign in with Google.');
      }

      // 5. Check if user exists in Firestore
      final existingUser = await getUserData(firebaseUser.uid);
      if (existingUser != null) {
        // Existing user - update last login
        await _usersCollection.doc(firebaseUser.uid).update({
          'last_login': FieldValue.serverTimestamp(),
        });
        return existingUser;
      }

      // 6. New user - don't create Firestore doc here
      // The Onboarding screen will handle profile creation via Backend
      return null;
    } on FirebaseAuthException catch (e) {
      throw AuthException.fromFirebase(e);
    } catch (e) {
      if (e is AuthException) rethrow;
      // Don't throw for user cancellation
      if (e.toString().contains('canceled')) return null;
      throw AuthException('Failed to sign in with Google: ${e.toString()}');
    }
  }

  // ==========================================================================
  // SIGN OUT
  // ==========================================================================

  /// Sign out the current user
  Future<void> signOut() async {
    try {
      // Sign out from Google as well
      await _googleSignIn.signOut();
      await _auth.signOut();
    } catch (e) {
      throw AuthException('Failed to sign out: ${e.toString()}');
    }
  }

  // ==========================================================================
  // USER DATA
  // ==========================================================================

  /// Get user data from Firestore
  ///
  /// [uid] - User's Firebase UID
  ///
  /// Returns [UserModel] if found, null otherwise
  Future<UserModel?> getUserData(String uid) async {
    try {
      debugPrint('AuthService: Fetching user data for $uid...');
      // Aggressive timeout for web to detect ad-blockers early
      final doc = await _usersCollection.doc(uid).get().timeout(
        const Duration(seconds: kIsWeb ? 5 : 10),
        onTimeout: () {
          debugPrint('AuthService: !!! Firestore GET timed out for $uid. Possibly blocked by ad-blocker.');
          throw const AuthException('Connection timed out. If you use Brave or an ad-blocker, please disable it for this site.');
        },
      );
      
      if (!doc.exists) {
        debugPrint('AuthService: User document does not exist for $uid');
        return null;
      }
      debugPrint('AuthService: User document found for $uid. Data: ${doc.data()}');
      return UserModel.fromFirestore(doc);
    } catch (e) {
      debugPrint('AuthService: Error fetching user data for $uid: $e');
      if (e is AuthException) rethrow;
      throw AuthException('Failed to fetch user data: ${e.toString()}');
    }
  }

  /// Get current user's data from Firestore
  Future<UserModel?> getCurrentUserData() async {
    final user = currentUser;
    if (user == null) return null;
    return getUserData(user.uid);
  }

  /// Check if user document exists in Firestore
  Future<bool> userExists(String uid) async {
    try {
      final doc = await _usersCollection.doc(uid).get();
      return doc.exists;
    } catch (e) {
      return false;
    }
  }

  // ==========================================================================
  // PASSWORD RESET
  // ==========================================================================

  /// Send password reset email
  ///
  /// [email] - User's email address
  Future<void> sendPasswordResetEmail(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email.trim());
    } on FirebaseAuthException catch (e) {
      throw AuthException.fromFirebase(e);
    } catch (e) {
      throw AuthException('Failed to send reset email: ${e.toString()}');
    }
  }

  // ==========================================================================
  // TOKEN
  // ==========================================================================

  /// Get Firebase ID token for API authentication
  ///
  /// [forceRefresh] - Force refresh the token even if not expired
  ///
  /// Returns the ID token string, or null if not signed in
  Future<String?> getIdToken({bool forceRefresh = false}) async {
    try {
      return await currentUser?.getIdToken(forceRefresh);
    } catch (e) {
      return null;
    }
  }
  // ==========================================================================
  // ONBOARDING & FILES
  // ==========================================================================

  /// Upload file to Firebase Storage
  /// Returns download URL
  Future<String> uploadFile(File file, String path) async {
    try {
      final ref = _storage.ref().child(path);
      await ref.putFile(file);
      return await ref.getDownloadURL();
    } catch (e) {
      throw AuthException('Failed to upload file: ${e.toString()}');
    }
  }

  /// Upload raw bytes to Firebase Storage (Web compatible)
  /// Returns download URL
  Future<String> uploadBytes(Uint8List bytes, String path) async {
    try {
      final ref = _storage.ref().child(path);
      await ref.putData(bytes);
      return await ref.getDownloadURL();
    } catch (e) {
      throw AuthException('Failed to upload file bytes: ${e.toString()}');
    }
  }

  /// Create user profile via Backend API
  /// This ensures consistency with the web onboarding flow
  Future<void> createBackendProfile({
    required String name,
    required String phoneNumber,
    required UserRole role,
    // Driver specific
    String? kycUrl,
    String? licenseUrl,
    String? plateNumber,
    String? vehicleModel,
    bool? isEv,
    String? pollutionExpiry,
    int? passengerCapacity,
  }) async {
    try {
      final user = currentUser;
      if (user == null) throw const AuthException('User not authenticated');

      final token = await user.getIdToken();
      if (token == null) throw const AuthException('Failed to get auth token');

      final Map<String, dynamic> body = {
        'name': name,
        'phone_number': phoneNumber,
        'role': role.value,
        'is_onboarded': true,
      };

      if (role == UserRole.driver) {
        body.addAll({
          'kyc_url': kycUrl,
          'license_url': licenseUrl,
          'plate_number': plateNumber,
          'vehicle_model': vehicleModel,
          'is_ev': isEv ?? false,
          'pollution_expiry': pollutionExpiry,
          'passenger_capacity': passengerCapacity,
        });
      }

      // 2. Local Firestore Update (Proactive)
      // This allows AuthGate to immediately pick up the onboarded status
      await _usersCollection.doc(user.uid).update({
        'name': name,
        'phone_number': phoneNumber,
        'role': role.value,
        'is_onboarded': true,
        if (role == UserRole.driver) ...{
          'kyc_url': kycUrl,
          'license_url': licenseUrl,
          'plate_number': plateNumber,
          'vehicle_model': vehicleModel,
          'is_ev': isEv ?? false,
          'pollution_expiry': pollutionExpiry,
          'passenger_capacity': passengerCapacity,
        },
        'updated_at': FieldValue.serverTimestamp(),
      });

      // 3. Call Backend API
      final response = await http.post(
        Uri.parse('$_backendUrl/user'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(body),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode != 201 && response.statusCode != 200) {
        // We log backend errors but don't fail the mobile flow if Firestore is updated
        debugPrint('AuthService: Backend API returned ${response.statusCode}: ${response.body}');
      }
    } catch (e) {
      debugPrint('AuthService: Profile creation error: $e');
      if (e is AuthException) rethrow;
      throw AuthException('Failed to complete setup: ${e.toString()}');
    }
  }
}
