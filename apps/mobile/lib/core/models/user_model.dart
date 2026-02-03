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
      savedLocations: (data['saved_locations'] as List<dynamic>?)
          ?.cast<Map<String, dynamic>>(),
      createdAt: (data['created_at'] as Timestamp?)?.toDate(),
      lastLogin: (data['last_login'] as Timestamp?)?.toDate(),
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
    );
  }

  @override
  String toString() {
    return 'UserModel(uid: $uid, email: $email, name: $name, role: ${role.value})';
  }
}
