import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';

/// Service to handle SOS emergency alerts for riders.
///
/// Uses device-native SMS (no Twilio) so the alert works even if
/// the backend is unreachable. Fetches the latest GPS fix and
/// sends a pre-formatted distress message to the configured
/// emergency contacts.
class SosService {
  SosService._();
  static final SosService instance = SosService._();

  // ── Public API ──────────────────────────────────────────────

  /// Request SMS sending permissions (Android only).
  /// iOS doesn't require explicit SMS permissions.
  Future<bool> requestSmsPermissions() async {
    if (!Platform.isAndroid) {
      return true; // iOS doesn't require SMS permissions
    }

    try {
      final status = await Permission.sms.request();
      debugPrint('SosService: SMS permission status – $status');
      return status.isGranted;
    } catch (e) {
      debugPrint('SosService: Error requesting SMS permission – $e');
      return false;
    }
  }

  /// Triggers the SOS flow:
  /// 1. Resolves the rider's current GPS coordinates.
  /// 2. Composes the distress SMS with a Google Maps link.
  /// 3. Sends the SMS to every number in [emergencyContacts].
  ///
  /// Returns a [SosResult] indicating success / partial / failure.
  Future<SosResult> triggerSos({
    required List<String> emergencyContacts,
    String? riderName,
  }) async {
    try {
      // 1. Get GPS position
      final position = await _getPosition();

      // 2. Compose message
      final message = _composeMessage(
        latitude: position.latitude,
        longitude: position.longitude,
        riderName: riderName,
      );

      // 3. Send to each contact
      int sent = 0;
      int failed = 0;
      for (final number in emergencyContacts) {
        final ok = await _sendSms(number.trim(), message);
        if (ok) {
          sent++;
        } else {
          failed++;
        }
      }

      if (sent == emergencyContacts.length) {
        return SosResult(
          status: SosStatus.success,
          message: 'SOS alert sent to $sent contact${sent > 1 ? 's' : ''}.',
          latitude: position.latitude,
          longitude: position.longitude,
        );
      } else if (sent > 0) {
        return SosResult(
          status: SosStatus.partial,
          message:
              'Alert sent to $sent/${emergencyContacts.length} contacts ($failed failed).',
          latitude: position.latitude,
          longitude: position.longitude,
        );
      } else {
        return SosResult(
          status: SosStatus.failure,
          message: 'Could not send SMS. Please check permissions in Settings.',
        );
      }
    } catch (e) {
      debugPrint('SosService: Error during SOS trigger – $e');
      return SosResult(
        status: SosStatus.failure,
        message: 'SOS failed: ${e.toString()}',
      );
    }
  }

  // ── Internal helpers ────────────────────────────────────────

  /// Resolves the device's current position with high accuracy.
  Future<Position> _getPosition() async {
    // Check if location services are enabled
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw Exception('Location services are disabled. Please enable GPS.');
    }

    // Check / request permission
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw Exception('Location permission denied.');
      }
    }

    if (permission == LocationPermission.deniedForever) {
      throw Exception(
        'Location permission permanently denied. Please enable it in Settings.',
      );
    }

    // Fetch position (high accuracy, 8-second timeout)
    return await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 8),
      ),
    );
  }

  /// Composes the SOS distress message with a Google Maps link.
  String _composeMessage({
    required double latitude,
    required double longitude,
    String? riderName,
  }) {
    final mapsLink = 'https://maps.google.com/?q=$latitude,$longitude';
    final nameSegment = (riderName != null && riderName.isNotEmpty)
        ? ' ($riderName)'
        : '';

    return '🚨 SOS ALERT\n'
        'The rider$nameSegment may be in danger during a trip.\n\n'
        'Location:\n'
        '$mapsLink';
  }

  /// Sends a single SMS via the device's native SMS stack.
  /// - Android: Opens SMS app or sends via native intent
  /// - iOS: Opens Messages app with pre-filled SMS (user must confirm send)
  /// Returns `true` if successful.
  Future<bool> _sendSms(String to, String body) async {
    try {
      final uri = Uri(scheme: 'sms', path: to, queryParameters: {'body': body});

      if (await canLaunchUrl(uri)) {
        await launchUrl(uri);
        debugPrint('SosService: SMS intent launched for $to');
        return true;
      } else {
        debugPrint('SosService: Cannot launch SMS URI for $to');
        return false;
      }
    } catch (e) {
      debugPrint('SosService: Failed to send SMS to $to – $e');
      return false;
    }
  }
}

// ── Result types ────────────────────────────────────────────────

enum SosStatus { success, partial, failure }

class SosResult {
  final SosStatus status;
  final String message;
  final double? latitude;
  final double? longitude;

  const SosResult({
    required this.status,
    required this.message,
    this.latitude,
    this.longitude,
  });
}
