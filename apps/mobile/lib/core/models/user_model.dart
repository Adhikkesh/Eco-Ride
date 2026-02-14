/// User Model
/// Mirrors the Firestore 'users' collection schema.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import '../constants/app_constants.dart';

class UserModel {
  final String uid;
  final String email;
  final String? name;
  final String? phoneNumber;
  final UserRole role;
  final int greenPoints;
  final double trustScore;
  final String? fcmToken;
  final List<Map<String, dynamic>>? savedLocations;
  final DateTime? createdAt;
  final DateTime? lastLogin;
  
  // Onboarding Status
  final bool isOnboarded;

  // Driver Specific Fields
  final String? kycUrl;
  final String? licenseUrl;
  final String? plateNumber;
  final String? vehicleModel;
  final bool isEv;
  final String? pollutionExpiry;
  final int? passengerCapacity;

  const UserModel({
    required this.uid,
    required this.email,
    this.name,
    this.phoneNumber,
    required this.role,
    this.greenPoints = 0,
    this.trustScore = 0.0,
    this.fcmToken,
    this.savedLocations,
    this.createdAt,
    this.lastLogin,
    this.isOnboarded = false,
    this.kycUrl,
    this.licenseUrl,
    this.plateNumber,
    this.vehicleModel,
    this.isEv = false,
    this.pollutionExpiry,
    this.passengerCapacity,
  });

  /// Create UserModel from Firestore document
  factory UserModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};
    return UserModel(
      uid: doc.id,
      email: data['email'] as String? ?? '',
      name: data['name'] as String?,
      phoneNumber: data['phone_number'] as String?,
      role: UserRole.fromString(data['role'] as String? ?? 'rider'),
      greenPoints: (data['green_points'] as num?)?.toInt() ?? 0,
      trustScore: (data['trust_score'] as num?)?.toDouble() ?? 0.0,
      fcmToken: data['fcm_token'] as String?,
      savedLocations: (data['saved_locations'] is List)
          ? (data['saved_locations'] as List<dynamic>)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList()
          : null,
      createdAt: (data['created_at'] as Timestamp?)?.toDate(),
      lastLogin: (data['last_login'] as Timestamp?)?.toDate(),
      isOnboarded: data['is_onboarded'] as bool? ?? false,
      kycUrl: data['kyc_url'] as String?,
      licenseUrl: data['license_url'] as String?,
      plateNumber: data['plate_number'] as String?,
      vehicleModel: data['vehicle_model'] as String?,
      isEv: data['is_ev'] as bool? ?? false,
      pollutionExpiry: data['pollution_expiry'] as String?,
      passengerCapacity: (data['passenger_capacity'] as num?)?.toInt(),
    );
  }

  /// Convert to Firestore document data
  Map<String, dynamic> toFirestore() {
    return {
      'uid': uid,
      'email': email,
      'name': name,
      'phone_number': phoneNumber,
      'role': role.value,
      'green_points': greenPoints,
      'trust_score': trustScore,
      'fcm_token': fcmToken,
      'saved_locations': savedLocations,
      'created_at': createdAt != null ? Timestamp.fromDate(createdAt!) : FieldValue.serverTimestamp(),
      'last_login': FieldValue.serverTimestamp(),
      'is_onboarded': isOnboarded,
      'kyc_url': kycUrl,
      'license_url': licenseUrl,
      'plate_number': plateNumber,
      'vehicle_model': vehicleModel,
      'is_ev': isEv,
      'pollution_expiry': pollutionExpiry,
      'passenger_capacity': passengerCapacity,
    };
  }

  /// Create a copy with updated fields
  UserModel copyWith({
    String? uid,
    String? email,
    String? name,
    String? phoneNumber,
    UserRole? role,
    int? greenPoints,
    double? trustScore,
    String? fcmToken,
    List<Map<String, dynamic>>? savedLocations,
    DateTime? createdAt,
    DateTime? lastLogin,
    bool? isOnboarded,
    String? kycUrl,
    String? licenseUrl,
    String? plateNumber,
    String? vehicleModel,
    bool? isEv,
    String? pollutionExpiry,
    int? passengerCapacity,
  }) {
    return UserModel(
      uid: uid ?? this.uid,
      email: email ?? this.email,
      name: name ?? this.name,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      role: role ?? this.role,
      greenPoints: greenPoints ?? this.greenPoints,
      trustScore: trustScore ?? this.trustScore,
      fcmToken: fcmToken ?? this.fcmToken,
      savedLocations: savedLocations ?? this.savedLocations,
      createdAt: createdAt ?? this.createdAt,
      lastLogin: lastLogin ?? this.lastLogin,
      isOnboarded: isOnboarded ?? this.isOnboarded,
      kycUrl: kycUrl ?? this.kycUrl,
      licenseUrl: licenseUrl ?? this.licenseUrl,
      plateNumber: plateNumber ?? this.plateNumber,
      vehicleModel: vehicleModel ?? this.vehicleModel,
      isEv: isEv ?? this.isEv,
      pollutionExpiry: pollutionExpiry ?? this.pollutionExpiry,
      passengerCapacity: passengerCapacity ?? this.passengerCapacity,
    );
  }

  @override
  String toString() {
    return 'UserModel(uid: $uid, email: $email, name: $name, role: ${role.value}, isOnboarded: $isOnboarded)';
  }
}
