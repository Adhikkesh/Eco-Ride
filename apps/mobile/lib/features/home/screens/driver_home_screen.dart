import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:location/location.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../../core/services/map_service.dart';
import '../../auth/screens/login_screen.dart';
import 'driver_profile_screen.dart';

class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  final Completer<GoogleMapController> _controller =
      Completer<GoogleMapController>();
  final Location _location = Location();
  final FirebaseDatabase _rtdb = FirebaseDatabase.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  static const CameraPosition _kDefaultLocation = CameraPosition(
    target: LatLng(11.0168, 76.9558), // Coimbatore
    zoom: 14.4746,
  );

  bool _isOnline = false;
  bool _isLoading = true;
  LatLng? _currentPosition;
  double _currentHeading = 0.0;
  StreamSubscription<LocationData>? _locationSubscription;
  StreamSubscription<DatabaseEvent>? _rideSubscription;
  StreamSubscription<DatabaseEvent>? _pendingRideSubscription;
  Map<dynamic, dynamic>? _currentRide;
  Map<dynamic, dynamic>? _pendingRide;
  bool _isNavigating = false;
  Set<Marker> _markers = {};
  Set<Polyline> _polylines = {};
  BitmapDescriptor? _carIcon;

  // Simulation state (moves car along polyline like web simulator)
  Timer? _simTimer;
  List<LatLng> _simRoutePoints = [];
  double _simDistanceTraveled = 0;
  double _simTotalDistance = 0;
  static const double _simSpeedMps = 12.5; // ~45 km/h in m/s

  // Ride lifecycle state
  String _rideStatus =
      'idle'; // idle, pending, matched, arrived, in_progress, completed
  String? _rideId;
  String? _riderName;
  String? _riderPhone;
  bool _isAccepting = false;
  bool _isDeclining = false;
  bool _isArriving = false;
  final TextEditingController _otpController = TextEditingController();

  // Pooled ride state
  List<Map<dynamic, dynamic>>? _pooledRiders;
  int _previousRidersCount = 0;
  bool get _isPooledRide => _pooledRiders != null && _pooledRiders!.length > 1;

  // ETA & distance from Directions API
  String _etaText = '';
  String _distanceText = '';

  String? _userName;
  String? _userPhoto;
  String? _userEmail;
  StreamSubscription<DatabaseEvent>? _paymentSubscription;
  double? _paidFare;

  // Theme state
  bool _isDarkMode = true;
  String? _darkMapStyle;

  // Dynamic today's stats
  double _todayEarnings = 0;
  int _todayRides = 0;

  @override
  void initState() {
    super.initState();
    _loadUserData();
    _checkInitialLocation();
    _createCarIcon();
    _loadDarkMapStyle();
    _loadTodayStats();
  }

  @override
  void dispose() {
    _locationSubscription?.cancel();
    _pendingRideSubscription?.cancel();
    _rideSubscription?.cancel();
    _otpTimer?.cancel();
    _paymentSubscription?.cancel();
    _simTimer?.cancel();
    _otpController.dispose();
    if (_isOnline) {
      _goOffline();
    }
    super.dispose();
  }

  Future<void> _loadUserData() async {
    final user = AuthService.instance.currentUser;
    if (user != null) {
      _userEmail = user.email;
      // Try to get displayName from Firestore first
      try {
        final userDoc = await FirebaseFirestore.instance
            .collection('users')
            .doc(user.uid)
            .get();
        if (userDoc.exists) {
          final data = userDoc.data()!;
          final firestoreName = data['displayName']?.toString();
          final fallbackName = data['name']?.toString();
          setState(() {
            _userName = (firestoreName != null && firestoreName.isNotEmpty)
                ? firestoreName
                : (fallbackName != null && fallbackName.isNotEmpty)
                ? fallbackName
                : user.displayName ?? 'Driver';
            _userPhoto = data['photoURL']?.toString() ?? user.photoURL;
            _userEmail = data['email']?.toString() ?? user.email;
          });
        } else {
          setState(() {
            _userName = user.displayName ?? 'Driver';
            _userPhoto = user.photoURL;
          });
        }
      } catch (e) {
        setState(() {
          _userName = user.displayName ?? 'Driver';
          _userPhoto = user.photoURL;
        });
      }
    }
  }

  /// Load dark map style JSON
  Future<void> _loadDarkMapStyle() async {
    _darkMapStyle = '''[
      {"elementType": "geometry", "stylers": [{"color": "#242f3e"}]},
      {"elementType": "labels.text.stroke", "stylers": [{"color": "#242f3e"}]},
      {"elementType": "labels.text.fill", "stylers": [{"color": "#746855"}]},
      {"featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{"color": "#d59563"}]},
      {"featureType": "poi", "elementType": "labels.text.fill", "stylers": [{"color": "#d59563"}]},
      {"featureType": "poi.park", "elementType": "geometry", "stylers": [{"color": "#263c3f"}]},
      {"featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{"color": "#6b9a76"}]},
      {"featureType": "road", "elementType": "geometry", "stylers": [{"color": "#38414e"}]},
      {"featureType": "road", "elementType": "geometry.stroke", "stylers": [{"color": "#212a37"}]},
      {"featureType": "road", "elementType": "labels.text.fill", "stylers": [{"color": "#9ca5b3"}]},
      {"featureType": "road.highway", "elementType": "geometry", "stylers": [{"color": "#746855"}]},
      {"featureType": "road.highway", "elementType": "geometry.stroke", "stylers": [{"color": "#1f2835"}]},
      {"featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{"color": "#f3d19c"}]},
      {"featureType": "transit", "elementType": "geometry", "stylers": [{"color": "#2f3948"}]},
      {"featureType": "transit.station", "elementType": "labels.text.fill", "stylers": [{"color": "#d59563"}]},
      {"featureType": "water", "elementType": "geometry", "stylers": [{"color": "#17263c"}]},
      {"featureType": "water", "elementType": "labels.text.fill", "stylers": [{"color": "#515c6d"}]},
      {"featureType": "water", "elementType": "labels.text.stroke", "stylers": [{"color": "#17263c"}]}
    ]''';
  }

  /// Toggle dark/light theme
  Future<void> _toggleTheme() async {
    setState(() => _isDarkMode = !_isDarkMode);
    try {
      final controller = await _controller.future;
      if (_isDarkMode && _darkMapStyle != null) {
        await controller.setMapStyle(_darkMapStyle);
      } else {
        await controller.setMapStyle(null);
      }
    } catch (e) {
      debugPrint('DriverHome: Error toggling theme: $e');
    }
  }

  /// Load today's earnings and rides from Firestore
  Future<void> _loadTodayStats() async {
    final user = _auth.currentUser;
    if (user == null) return;

    try {
      final now = DateTime.now();
      final startOfDay = DateTime(now.year, now.month, now.day);
      final endOfDay = startOfDay.add(const Duration(days: 1));

      final ridesSnapshot = await FirebaseFirestore.instance
          .collection('rides')
          .where('driverId', isEqualTo: user.uid)
          .where('status', isEqualTo: 'COMPLETED')
          .get();

      double earnings = 0;
      int rides = 0;

      for (final doc in ridesSnapshot.docs) {
        final data = doc.data();
        // Check timestamp for today
        final timestamp = data['timestamp'] as Timestamp?;
        final createdAt = data['createdAt'] as Timestamp?;
        final ts = timestamp ?? createdAt;
        if (ts != null) {
          final rideDate = ts.toDate();
          if (rideDate.isAfter(startOfDay) && rideDate.isBefore(endOfDay)) {
            earnings += (data['fare'] as num?)?.toDouble() ?? 0;
            rides++;
          }
        }
      }

      if (mounted) {
        setState(() {
          _todayEarnings = earnings;
          _todayRides = rides;
        });
      }
    } catch (e) {
      debugPrint('DriverHome: Error loading today stats: $e');
    }
  }

  Future<void> _checkInitialLocation() async {
    try {
      final locationData = await _location.getLocation();
      setState(() {
        _currentPosition = LatLng(
          locationData.latitude!,
          locationData.longitude!,
        );
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
    }
  }

  void _toggleOnlineStatus() async {
    if (_isOnline) {
      await _goOffline();
    } else {
      await _goOnline();
    }
  }

  Future<void> _goOnline() async {
    bool serviceEnabled;
    PermissionStatus permissionGranted;

    try {
      debugPrint('DriverHome: Checking location services...');
      serviceEnabled = await _location.serviceEnabled();
      if (!serviceEnabled) {
        serviceEnabled = await _location.requestService();
        if (!serviceEnabled) {
          debugPrint('DriverHome: Location service disabled');
          return;
        }
      }

      debugPrint('DriverHome: Checking location permissions...');
      permissionGranted = await _location.hasPermission();
      if (permissionGranted == PermissionStatus.denied) {
        permissionGranted = await _location.requestPermission();
        if (permissionGranted != PermissionStatus.granted) {
          debugPrint('DriverHome: Location permission denied');
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Location permission required to go online.'),
              ),
            );
          }
          return;
        }
      }

      // Initial location check before starting stream
      final initialLocation = await _location.getLocation().timeout(
        const Duration(seconds: 20),
      );
      final initialPos = LatLng(
        initialLocation.latitude!,
        initialLocation.longitude!,
      );
      setState(() {
        _currentPosition = initialPos;
        _isOnline = true;
      });

      // Create the RTDB node with set() for the first time (node doesn't exist yet)
      final userId0 = _auth.currentUser?.uid;
      if (userId0 != null) {
        await _rtdb.ref('drivers-online/$userId0').set({
          'lat': initialPos.latitude,
          'lng': initialPos.longitude,
          'heading': 0.0,
          'status': 'AVAILABLE',
          'lastUpdated': ServerValue.timestamp,
          'vehicleType': 'CAR',
        });
      }

      debugPrint('DriverHome: Starting location stream...');
      _locationSubscription = _location.onLocationChanged.listen((
        LocationData locationData,
      ) {
        if (locationData.latitude == null || locationData.longitude == null)
          return;

        final newPos = LatLng(locationData.latitude!, locationData.longitude!);
        final heading = locationData.heading ?? 0.0;

        if (mounted) {
          setState(() {
            // During navigation, simulation controls position — skip GPS updates
            if (!_isNavigating) {
              _currentPosition = newPos;
              _currentHeading = heading;
            }
          });
        }

        // Only write GPS to Firebase and update camera when NOT navigating
        if (!_isNavigating) {
          _updateFirebaseLocation(newPos, heading);
          _updateCamera(newPos);
        }
      });

      // Listen for PENDING ride requests (driver must accept/decline)
      final userId = _auth.currentUser?.uid;
      if (userId != null) {
        debugPrint(
          'DriverHome: Listening for pending rides at rides-pending/$userId',
        );
        _pendingRideSubscription = _rtdb
            .ref('rides-pending/$userId')
            .onValue
            .listen((event) {
              final data = event.snapshot.value as Map<dynamic, dynamic>?;
              if (data != null && data['status'] == 'PENDING_ACCEPTANCE') {
                debugPrint('DriverHome: PENDING RIDE RECEIVED! $data');
                if (mounted) {
                  setState(() {
                    _pendingRide = data;
                    _rideId = data['rideId']?.toString();
                    _rideStatus = 'pending';
                    _riderName = data['riderName']?.toString() ?? 'Rider';
                    _riderPhone = data['riderPhone']?.toString() ?? '';
                  });
                  // Reverse geocode pickup/drop if names look like coordinates
                  _resolveLocationNames(data);
                }
              } else {
                if (_pendingRide != null && mounted) {
                  setState(() {
                    _pendingRide = null;
                    if (_rideStatus == 'pending') _rideStatus = 'idle';
                  });
                }
              }
            });

        // Listen for ride assignments (after accept)
        debugPrint(
          'DriverHome: Listening for assigned rides at rides-assigned/$userId',
        );
        _rideSubscription = _rtdb.ref('rides-assigned/$userId').onValue.listen((
          event,
        ) {
          final data = event.snapshot.value as Map<dynamic, dynamic>?;
          if (data != null) {
            debugPrint('DriverHome: RIDE ASSIGNED! $data');
            if (mounted) {
              setState(() {
                _currentRide = data;
                _rideId = data['rideId']?.toString() ?? _rideId;

                // Guard status transitions — don't let RTDB auto-skip OTP step
                final newStatus = (data['status']?.toString() ?? 'MATCHED')
                    .toLowerCase();
                if (newStatus == 'in_progress' && _rideStatus != 'arrived') {
                  // Don't jump to in_progress unless driver has locally arrived + verified OTP
                  debugPrint(
                    'DriverHome: Ignoring RTDB in_progress — driver still in $_rideStatus (OTP not verified locally)',
                  );
                } else if (newStatus == 'arrived' && _rideStatus == 'matched') {
                  // Only accept arrived if driver explicitly triggered it
                  debugPrint(
                    'DriverHome: Ignoring RTDB arrived — driver must tap "Arrived at Pickup" button',
                  );
                } else {
                  _rideStatus = newStatus;
                }

                _riderName =
                    data['riderName']?.toString() ?? _riderName ?? 'Rider';
                _riderPhone =
                    data['riderPhone']?.toString() ?? _riderPhone ?? '';

                // Parse pooled riders
                if (data['riders'] != null && data['riders'] is List) {
                  final riders = (data['riders'] as List)
                      .cast<Map<dynamic, dynamic>>();
                  _pooledRiders = riders;
                  // Mid-trip new rider detection
                  if (_previousRidersCount > 0 &&
                      riders.length > _previousRidersCount) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'New rider added to your pooled trip! 🚗',
                        ),
                        backgroundColor: Colors.blue,
                      ),
                    );
                    // Re-navigate for new pickup
                    _navigateToRide();
                  }
                  _previousRidersCount = riders.length;
                }
              });
              // Auto-navigate to pickup on first assignment
              if (!_isNavigating) {
                _navigateToRide();
              }
              // Resolve location names if needed
              _resolveLocationNames(data);
            }
          } else {
            // Ride assignment removed from RTDB
            // Only reset if we're in early stages (pending/matched)
            // During active phases (arrived, in_progress, waiting_payment),
            // the backend simulator may clean up RTDB but the driver app
            // should keep its state until the driver explicitly completes the ride.
            if (_currentRide != null && mounted) {
              final activePhases = [
                'arrived',
                'in_progress',
                'waiting_payment',
              ];
              if (activePhases.contains(_rideStatus)) {
                debugPrint(
                  'DriverHome: RTDB assignment removed but ride is in $_rideStatus phase — keeping state',
                );
              } else {
                debugPrint(
                  'DriverHome: Ride assignment removed (status=$_rideStatus). Resetting.',
                );
                _resetRideState();
              }
            }
          }
        });
      }
    } catch (e) {
      debugPrint('DriverHome: !!! Geolocation Error going online: $e');
      if (mounted) {
        setState(() => _isOnline = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Error going online: ${e.toString().contains('denied') ? 'Location permission denied' : 'Could not fetch location'}',
            ),
          ),
        );
      }
    }
  }

  Timer? _otpTimer;
  int _otpTimeRemaining = 300; // 5 minutes in seconds

  /// Accept a pending ride via backend API, then navigate
  Future<void> _acceptRide() async {
    if (_rideId == null) {
      debugPrint('DriverHome: Cannot accept ride - Ride ID is null');
      return;
    }
    setState(() => _isAccepting = true);

    try {
      debugPrint('DriverHome: Accepting ride $_rideId...');
      final result = await MapService.acceptRide(_rideId!);
      debugPrint('DriverHome: Accept result: $result');
      debugPrint('DriverHome: result is null? ${result == null}');
      if (result != null) {
        debugPrint(
          'DriverHome: success=${result['success']}, message=${result['message']}',
        );
      }

      if (result != null && result['success'] == true) {
        debugPrint('DriverHome: Ride accepted successfully!');
        if (mounted) {
          setState(() {
            _pendingRide = null;
            _rideStatus = 'matched';
            _isAccepting = false;
          });
          // rides-assigned listener will pick up the ride and trigger navigation.
          // As a fallback, if _currentRide is already populated by the listener
          // but navigation hasn't started, trigger it now.
          if (_currentRide != null && !_isNavigating) {
            debugPrint(
              'DriverHome: Fallback — triggering navigation directly after accept',
            );
            _navigateToRide();
          }
        }
      } else {
        final message = result?['message'] ?? 'Ride is no longer available';
        debugPrint('DriverHome: Accept failed: $message');
        // Ride no longer valid (cancelled, expired, etc.) — clear stale data
        if (mounted) {
          _clearPendingRide();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(message), backgroundColor: Colors.orange),
          );
        }
      }
    } catch (e) {
      debugPrint('DriverHome: Error accepting ride: $e');
      if (mounted) {
        _clearPendingRide();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Connection error. Ride cleared.')),
        );
      }
    } finally {
      if (mounted) setState(() => _isAccepting = false);
    }
  }

  /// Decline a pending ride
  Future<void> _declineRide() async {
    if (_rideId == null) return;
    setState(() => _isDeclining = true);

    try {
      final result = await MapService.declineRide(_rideId!);
      if (mounted) {
        if (result != null && result['success'] == true) {
          // Successfully declined
          _clearPendingRide();
        } else {
          // Backend failed (ride already cancelled/not found) — clear stale data anyway
          debugPrint('DriverHome: Decline failed, clearing stale pending data');
          _clearPendingRide();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Ride was already cancelled. Cleared.'),
            ),
          );
        }
      }
    } catch (e) {
      debugPrint('DriverHome: Error declining ride: $e — clearing stale data');
      // Network error — still clear the stale RTDB data so it doesn't keep showing
      if (mounted) _clearPendingRide();
    } finally {
      if (mounted) setState(() => _isDeclining = false);
    }
  }

  /// Clear pending ride from both local state and Firebase RTDB
  void _clearPendingRide() {
    final userId = _auth.currentUser?.uid;
    if (userId != null) {
      _rtdb.ref('rides-pending/$userId').remove();
    }
    setState(() {
      _pendingRide = null;
      _rideStatus = 'idle';
      _rideId = null;
    });
  }

  /// Reverse geocode pickup/drop if names are missing or look like coordinates
  Future<void> _resolveLocationNames(Map<dynamic, dynamic> data) async {
    bool _looksLikeCoords(String? name) {
      if (name == null || name.isEmpty) return true;
      // If the name is just numbers, dots, commas and spaces it's likely coords
      return RegExp(r'^[\d\.\,\s\-]+$').hasMatch(name.trim());
    }

    final pickupName = data['pickupName']?.toString();
    final dropName = data['dropName']?.toString();
    final pickup = data['pickup'];
    final drop = data['drop'];

    // Resolve pickup name
    if (_looksLikeCoords(pickupName) && pickup != null) {
      final lat = (pickup['lat'] as num?)?.toDouble();
      final lng = (pickup['lng'] as num?)?.toDouble();
      if (lat != null && lng != null) {
        final resolved = await MapService.reverseGeocode(lat, lng);
        if (resolved != null && mounted) {
          setState(() {
            if (_pendingRide != null) _pendingRide!['pickupName'] = resolved;
            if (_currentRide != null) _currentRide!['pickupName'] = resolved;
          });
        }
      }
    }

    // Resolve drop name
    if (_looksLikeCoords(dropName) && drop != null) {
      final lat = (drop['lat'] as num?)?.toDouble();
      final lng = (drop['lng'] as num?)?.toDouble();
      if (lat != null && lng != null) {
        final resolved = await MapService.reverseGeocode(lat, lng);
        if (resolved != null && mounted) {
          setState(() {
            if (_pendingRide != null) _pendingRide!['dropName'] = resolved;
            if (_currentRide != null) _currentRide!['dropName'] = resolved;
          });
        }
      }
    }
  }

  /// Navigation logic — draws blue route (driver→pickup) and green route (pickup→destination)
  Future<void> _navigateToRide() async {
    if (_currentPosition == null || _currentRide == null) return;

    setState(() => _isNavigating = true);

    final pickup = _currentRide!['pickup'];
    final drop = _currentRide!['drop'];
    if (pickup == null || drop == null) return;

    final pickupLatLng = LatLng(
      (pickup['lat'] as num).toDouble(),
      (pickup['lng'] as num).toDouble(),
    );
    final dropLatLng = LatLng(
      (drop['lat'] as num).toDouble(),
      (drop['lng'] as num).toDouble(),
    );

    try {
      // Fetch both routes in parallel
      final results = await Future.wait([
        MapService.getDirections(_currentPosition!, pickupLatLng),
        MapService.getDirections(pickupLatLng, dropLatLng),
      ]);

      final toPickup = results[0];
      final toDrop = results[1];

      if (!mounted) return;

      // Store ETA & distance (driver → pickup)
      if (toPickup != null) {
        setState(() {
          _etaText = toPickup['duration']?.toString() ?? '';
          _distanceText = toPickup['distance']?.toString() ?? '';
        });
      }

      final newPolylines = <Polyline>{};
      final newMarkers = <Marker>{};
      List<LatLng> allPoints = [];

      // Blue polyline: Driver → Pickup
      if (toPickup != null) {
        final points = toPickup['points'] as List<LatLng>;
        newPolylines.add(
          Polyline(
            polylineId: const PolylineId('to_pickup'),
            points: points,
            color: const Color(0xFF2196F3), // Blue
            width: 5,
          ),
        );
        allPoints.addAll(points);
      }

      // Green polyline: Pickup → Destination
      if (toDrop != null) {
        final points = toDrop['points'] as List<LatLng>;
        newPolylines.add(
          Polyline(
            polylineId: const PolylineId('to_destination'),
            points: points,
            color: const Color(0xFF4CAF50), // Green
            width: 5,
          ),
        );
        allPoints.addAll(points);
      }

      // Add markers for pickup (blue) and destination (red)
      newMarkers.add(
        Marker(
          markerId: const MarkerId('pickup'),
          position: pickupLatLng,
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
          infoWindow: InfoWindow(
            title: 'Pickup',
            snippet:
                _currentRide!['pickupName']?.toString() ?? 'Pickup Location',
          ),
        ),
      );
      newMarkers.add(
        Marker(
          markerId: const MarkerId('destination'),
          position: dropLatLng,
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
          infoWindow: InfoWindow(
            title: 'Destination',
            snippet: _currentRide!['dropName']?.toString() ?? 'Drop Location',
          ),
        ),
      );

      // Add the driver's car marker
      if (_currentPosition != null) {
        newMarkers.add(
          Marker(
            markerId: const MarkerId('driver_car'),
            position: _currentPosition!,
            rotation: _currentHeading,
            anchor: const Offset(0.5, 0.5),
            flat: true,
            icon:
                _carIcon ??
                BitmapDescriptor.defaultMarkerWithHue(
                  BitmapDescriptor.hueGreen,
                ),
            zIndex: 10,
          ),
        );
      }

      setState(() {
        _polylines = newPolylines;
        _markers = newMarkers;
      });

      // Start simulation: move car along the to_pickup route
      if (toPickup != null) {
        _startSimulation(toPickup['points'] as List<LatLng>);
      }

      // Fit camera to show all points
      if (allPoints.isNotEmpty) {
        Future.delayed(const Duration(milliseconds: 500), () async {
          final controller = await _controller.future;
          controller.animateCamera(
            CameraUpdate.newLatLngBounds(_getBounds(allPoints), 60),
          );
        });
      }
    } catch (e) {
      debugPrint('DriverHome: Error navigating: $e');
    }
  }

  // ... (keep existing methods)

  /// Cancel the ride via backend API (e.g. timeout or driver cancelled)
  Future<void> _cancelRide() async {
    if (_rideId == null) return;
    setState(() => _isLoading = true);

    try {
      final result = await MapService.cancelRide(_rideId!);

      if (mounted) {
        if (result != null && result['success'] == true) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Ride cancelled successfully.')),
          );
          _resetRideState();
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(result?['message'] ?? 'Failed to cancel ride'),
            ),
          );
        }
      }
    } catch (e) {
      debugPrint('DriverHome: Error cancelling ride: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Mark arrival at pickup via backend
  Future<void> _handleArriveAtPickup() async {
    if (_rideId == null) return;

    setState(() => _isArriving = true);

    try {
      // Notify backend (best-effort — timer starts regardless)
      final result = await MapService.arriveAtPickup(
        _rideId!,
      ).timeout(const Duration(seconds: 5), onTimeout: () => null);
      if (result != null && result['success'] == true) {
        debugPrint('DriverHome: Backend notified of arrival');
      } else {
        debugPrint('DriverHome: Backend arrive call failed or timed out');
      }
    } catch (e) {
      debugPrint('DriverHome: Error notifying arrival: $e');
    } finally {
      // Always transition to arrived state and start timer
      if (mounted) {
        _stopSimulation(); // Stop car simulation since we've arrived
        setState(() {
          _rideStatus = 'arrived';
          _isArriving = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Arrived! Waiting for rider (5 min timer started)'),
            backgroundColor: Colors.green,
            behavior: SnackBarBehavior.floating,
            margin: EdgeInsets.only(top: 10, left: 16, right: 16, bottom: 600),
          ),
        );
        _startOtpTimer();
      }
    }
  }

  void _startOtpTimer() {
    _otpTimer?.cancel();
    _otpTimeRemaining = 300; // 5 minutes
    _otpTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        if (_otpTimeRemaining > 0) {
          _otpTimeRemaining--;
        } else {
          timer.cancel();
          _handleOtpTimeout();
        }
      });
    });
  }

  Future<void> _handleOtpTimeout() async {
    debugPrint('DriverHome: OTP Timer expired. Cancelling ride...');
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Rider did not show up in 5 mins. Ride cancelled.'),
      ),
    );
    // Call cancel ride
    await _cancelRide(); // Reuse existing cancel method
  }

  /// Start ride after OTP verification
  Future<void> _handleStartRide(String otp) async {
    if (_rideId == null) return;

    final result = await MapService.startRide(_rideId!, otp);
    if (result != null && result['success'] == true && mounted) {
      setState(() => _rideStatus = 'in_progress');
      _otpTimer?.cancel();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trip started! 🚗'),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
          margin: EdgeInsets.only(top: 10, left: 16, right: 16, bottom: 600),
        ),
      );

      // Start simulation from pickup to destination
      _startTripSimulation();
    } else {
      final message = result?['message'] ?? 'Failed to start ride. Check OTP.';
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
      }
    }
  }

  /// Fetch pickup→destination route and start new simulation
  Future<void> _startTripSimulation() async {
    if (_currentRide == null) return;

    final pickup = _currentRide!['pickup'];
    final drop = _currentRide!['drop'];
    if (pickup == null || drop == null) return;

    final pickupLatLng = LatLng(
      (pickup['lat'] as num).toDouble(),
      (pickup['lng'] as num).toDouble(),
    );
    final dropLatLng = LatLng(
      (drop['lat'] as num).toDouble(),
      (drop['lng'] as num).toDouble(),
    );

    try {
      final directions = await MapService.getDirections(
        pickupLatLng,
        dropLatLng,
      );
      if (directions != null && mounted) {
        final points = directions['points'] as List<LatLng>;

        // Update ETA & distance for trip (pickup → destination)
        setState(() {
          _etaText = directions['duration']?.toString() ?? '';
          _distanceText = directions['distance']?.toString() ?? '';
        });

        // Clear old polylines and show only trip route (green)
        setState(() {
          _polylines.clear();
          _polylines.add(
            Polyline(
              polylineId: const PolylineId('to_destination'),
              points: points,
              color: const Color(0xFF4CAF50),
              width: 5,
            ),
          );
          // Remove pickup marker since trip has started
          _markers.removeWhere((m) => m.markerId.value == 'pickup');
          _isNavigating = true;
        });

        // Start car simulation along trip route
        _startSimulation(points);
      }
    } catch (e) {
      debugPrint('DriverHome: Error starting trip simulation: $e');
    }
  }

  /// Complete the ride via backend
  Future<void> _handleCompleteRide() async {
    if (_rideId == null) return;

    final result = await MapService.completeRide(_rideId!);
    if (result != null && mounted) {
      // Transition to waiting for payment state
      setState(() {
        _rideStatus = 'waiting_payment';
        _paidFare = null;
        _polylines.clear();
        _markers.clear();
        _isNavigating = false;
      });
      // Start listening for payment on this ride
      _startPaymentListener(_rideId!);
      // Refresh today's stats
      _loadTodayStats();
    } else if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Error completing ride')));
    }
  }

  /// Listen for payment confirmation on RTDB
  void _startPaymentListener(String rideId) {
    _paymentSubscription?.cancel();
    debugPrint('DriverHome: Listening for payment at rides/$rideId');
    _paymentSubscription = _rtdb.ref('rides/$rideId').onValue.listen((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>?;
      if (data == null) return;

      final status = data['status']?.toString();
      final paymentStatus = data['paymentStatus']?.toString();
      final paidAmount = data['paidAmount'];
      final fare = data['fare'];

      debugPrint(
        'DriverHome: Payment check — status=$status, paymentStatus=$paymentStatus, paidAmount=$paidAmount, fare=$fare',
      );

      if (paymentStatus == 'PAID' || status == 'PAYMENT_CONFIRMED') {
        final amount =
            (paidAmount as num?)?.toDouble() ?? (fare as num?)?.toDouble() ?? 0;
        debugPrint('DriverHome: Payment received! Amount: $amount');
        if (mounted) {
          setState(() {
            _paidFare = amount;
          });
        }
      }
    });
  }

  /// Reset all ride state
  void _resetRideState() {
    _paymentSubscription?.cancel();
    _paymentSubscription = null;
    _stopSimulation();
    setState(() {
      _currentRide = null;
      _pendingRide = null;
      _isNavigating = false;
      _rideStatus = 'idle';
      _rideId = null;
      _riderName = null;
      _riderPhone = null;
      _paidFare = null;
      _etaText = '';
      _distanceText = '';
      _pooledRiders = null;
      _previousRidersCount = 0;
      _polylines.clear();
      _markers.clear();
    });
  }

  LatLngBounds _getBounds(List<LatLng> points) {
    double minLat = points[0].latitude;
    double maxLat = points[0].latitude;
    double minLng = points[0].longitude;
    double maxLng = points[0].longitude;

    for (var p in points) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
    }

    return LatLngBounds(
      southwest: LatLng(minLat, minLng),
      northeast: LatLng(maxLat, maxLng),
    );
  }

  Future<void> _goOffline() async {
    await _locationSubscription?.cancel();
    _locationSubscription = null;
    await _rideSubscription?.cancel();
    _rideSubscription = null;
    await _pendingRideSubscription?.cancel();
    _pendingRideSubscription = null;

    final userId = _auth.currentUser?.uid;
    if (userId != null) {
      await _rtdb.ref('drivers-online/$userId').remove();
    }

    setState(() => _isOnline = false);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SIMULATION: Move car along polyline (mirrors backend DriverAgent)
  // ═══════════════════════════════════════════════════════════════════════

  /// Start simulation along a list of polyline points
  void _startSimulation(List<LatLng> routePoints) {
    _stopSimulation();
    if (routePoints.length < 2) return;

    _simRoutePoints = routePoints;
    _simDistanceTraveled = 0;

    // Calculate total route distance
    _simTotalDistance = 0;
    for (int i = 1; i < routePoints.length; i++) {
      _simTotalDistance += _haversine(routePoints[i - 1], routePoints[i]);
    }

    debugPrint(
      'DriverSim: Starting simulation, ${routePoints.length} points, ${_simTotalDistance.toStringAsFixed(0)}m total',
    );

    // 1-second tick loop (like backend simulator)
    _simTimer = Timer.periodic(const Duration(seconds: 1), (_) => _simTick());
  }

  /// Stop simulation
  void _stopSimulation() {
    _simTimer?.cancel();
    _simTimer = null;
    _simRoutePoints = [];
    _simDistanceTraveled = 0;
    _simTotalDistance = 0;
  }

  /// Each tick: advance along route, update marker + RTDB + trim polyline
  void _simTick() {
    if (_simRoutePoints.length < 2) return;

    // Advance distance
    _simDistanceTraveled += _simSpeedMps; // ~12.5m per tick at 45 km/h

    if (_simDistanceTraveled >= _simTotalDistance) {
      // Arrived at end of route
      _simDistanceTraveled = _simTotalDistance;
      final lastPt = _simRoutePoints.last;
      _updateSimPosition(lastPt, _currentHeading);
      _stopSimulation();
      debugPrint('DriverSim: Reached end of route');
      return;
    }

    // Find position along polyline at _simDistanceTraveled
    double accumulated = 0;
    for (int i = 1; i < _simRoutePoints.length; i++) {
      final segLen = _haversine(_simRoutePoints[i - 1], _simRoutePoints[i]);
      if (accumulated + segLen >= _simDistanceTraveled) {
        // Interpolate within this segment
        final remaining = _simDistanceTraveled - accumulated;
        final fraction = segLen > 0 ? remaining / segLen : 0.0;

        final lat =
            _simRoutePoints[i - 1].latitude +
            (_simRoutePoints[i].latitude - _simRoutePoints[i - 1].latitude) *
                fraction;
        final lng =
            _simRoutePoints[i - 1].longitude +
            (_simRoutePoints[i].longitude - _simRoutePoints[i - 1].longitude) *
                fraction;

        final interpPos = LatLng(lat, lng);

        // Calculate heading from previous to current
        final heading = _bearing(_simRoutePoints[i - 1], _simRoutePoints[i]);

        _updateSimPosition(interpPos, heading);

        // Trim active polyline: show only remaining points ahead of the car
        final remainingPoints = <LatLng>[
          interpPos,
          ..._simRoutePoints.sublist(i),
        ];
        setState(() {
          // Determine which polyline is active and trim it
          final hasPickup = _polylines.any(
            (p) => p.polylineId.value == 'to_pickup',
          );
          final polyId = hasPickup ? 'to_pickup' : 'to_destination';
          final polyColor = hasPickup
              ? const Color(0xFF2196F3)
              : const Color(0xFF4CAF50);

          _polylines.removeWhere((p) => p.polylineId.value == polyId);
          _polylines.add(
            Polyline(
              polylineId: PolylineId(polyId),
              points: remainingPoints,
              color: polyColor,
              width: 5,
            ),
          );
        });
        return;
      }
      accumulated += segLen;
    }
  }

  /// Update car marker position and write to RTDB
  void _updateSimPosition(LatLng pos, double heading) {
    if (!mounted) return;

    setState(() {
      _currentPosition = pos;
      _currentHeading = heading;

      // Update car marker
      _markers.removeWhere((m) => m.markerId.value == 'driver_car');
      _markers.add(
        Marker(
          markerId: const MarkerId('driver_car'),
          position: pos,
          rotation: heading,
          anchor: const Offset(0.5, 0.5),
          flat: true,
          icon:
              _carIcon ??
              BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
          zIndex: 10,
        ),
      );
    });

    // Write to RTDB so rider app can see movement
    _updateFirebaseLocation(pos, heading);
  }

  /// Haversine distance in meters
  double _haversine(LatLng a, LatLng b) {
    const R = 6371000.0; // Earth radius in meters
    final dLat = _toRad(b.latitude - a.latitude);
    final dLng = _toRad(b.longitude - a.longitude);
    final sinLat = math.sin(dLat / 2);
    final sinLng = math.sin(dLng / 2);
    final h =
        sinLat * sinLat +
        math.cos(_toRad(a.latitude)) *
            math.cos(_toRad(b.latitude)) *
            sinLng *
            sinLng;
    return 2 * R * math.asin(math.sqrt(h));
  }

  /// Calculate bearing from point a to point b in degrees
  double _bearing(LatLng a, LatLng b) {
    final dLng = _toRad(b.longitude - a.longitude);
    final lat1 = _toRad(a.latitude);
    final lat2 = _toRad(b.latitude);
    final y = math.sin(dLng) * math.cos(lat2);
    final x =
        math.cos(lat1) * math.sin(lat2) -
        math.sin(lat1) * math.cos(lat2) * math.cos(dLng);
    return (_toDeg(math.atan2(y, x)) + 360) % 360;
  }

  double _toRad(double deg) => deg * math.pi / 180;
  double _toDeg(double rad) => rad * 180 / math.pi;

  /// Create a custom car icon from canvas (same as rider app)
  Future<void> _createCarIcon() async {
    try {
      const double size = 48;
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);

      final bodyPaint = Paint()..color = const Color(0xFF22C55E);
      final shadowPaint = Paint()..color = const Color(0xFF16A34A);

      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.2, size * 0.15, size * 0.6, size * 0.75),
          const Radius.circular(6),
        ),
        shadowPaint,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.22, size * 0.12, size * 0.56, size * 0.72),
          const Radius.circular(5),
        ),
        bodyPaint,
      );

      final roofPaint = Paint()..color = const Color(0xFF86EFAC);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.28, size * 0.28, size * 0.44, size * 0.3),
          const Radius.circular(3),
        ),
        roofPaint,
      );

      final lightPaint = Paint()..color = Colors.white;
      canvas.drawCircle(Offset(size * 0.32, size * 0.18), 2, lightPaint);
      canvas.drawCircle(Offset(size * 0.68, size * 0.18), 2, lightPaint);

      final rearPaint = Paint()..color = const Color(0xFFEF4444);
      canvas.drawCircle(Offset(size * 0.32, size * 0.8), 2, rearPaint);
      canvas.drawCircle(Offset(size * 0.68, size * 0.8), 2, rearPaint);

      final wheelPaint = Paint()..color = const Color(0xFF1F2937);
      for (final offset in [
        Rect.fromLTWH(size * 0.14, size * 0.3, size * 0.1, size * 0.18),
        Rect.fromLTWH(size * 0.76, size * 0.3, size * 0.1, size * 0.18),
        Rect.fromLTWH(size * 0.14, size * 0.58, size * 0.1, size * 0.18),
        Rect.fromLTWH(size * 0.76, size * 0.58, size * 0.1, size * 0.18),
      ]) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(offset, const Radius.circular(2)),
          wheelPaint,
        );
      }

      final picture = recorder.endRecording();
      final img = await picture.toImage(size.toInt(), size.toInt());
      final byteData = await img.toByteData(format: ui.ImageByteFormat.png);

      if (byteData != null && mounted) {
        setState(() {
          _carIcon = BitmapDescriptor.bytes(byteData.buffer.asUint8List());
        });
      }
    } catch (e) {
      debugPrint('DriverHome: Error creating car icon: $e');
    }
  }

  void _updateFirebaseLocation(LatLng pos, double heading) async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) return;

    // Use update() instead of set() to avoid overwriting fields written by backend
    // (e.g. status=BUSY, pooledRides, currentPassengers, etc.)
    final Map<String, dynamic> locationData = {
      'lat': pos.latitude,
      'lng': pos.longitude,
      'heading': heading,
      'lastUpdated': ServerValue.timestamp,
      'vehicleType': 'CAR',
    };

    // Only set status to AVAILABLE when driver is truly idle (no active ride)
    final isIdle =
        _rideStatus == 'idle' && !_isNavigating && _currentRide == null;
    if (isIdle) {
      locationData['status'] = 'AVAILABLE';
    }

    await _rtdb.ref('drivers-online/$userId').update(locationData);
  }

  Future<void> _updateCamera(LatLng pos) async {
    final controller = await _controller.future;
    controller.animateCamera(
      CameraUpdate.newCameraPosition(CameraPosition(target: pos, zoom: 16)),
    );
  }

  Future<void> _handleLogout() async {
    if (_isOnline) await _goOffline();
    try {
      await AuthService.instance.signOut();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error logging out: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _isDarkMode
          ? const Color(0xFF0F172A)
          : AppColors.background,
      body: Stack(
        children: [
          // 1. Google Map
          GoogleMap(
            mapType: MapType.normal,
            initialCameraPosition: _kDefaultLocation,
            myLocationEnabled: true,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
            onMapCreated: (GoogleMapController controller) {
              _controller.complete(controller);
              // Apply dark map style on startup
              if (_isDarkMode && _darkMapStyle != null) {
                controller.setMapStyle(_darkMapStyle);
              }
            },
            markers: _markers,
            polylines: _polylines,
          ),

          // 2. Header and Status Toggle
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                children: [
                  _buildHeader(),
                  const Spacer(),
                  _buildStatusCard(),
                  const SizedBox(height: 16),
                  _buildStatsRow(),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),

          // 3. Incoming/Active Ride Sheet (hidden during waiting_payment)
          if ((_pendingRide != null || _currentRide != null) &&
              _rideStatus != 'waiting_payment')
            Align(
              alignment: Alignment.bottomCenter,
              child: _buildIncomingRideSheet(),
            ),

          // 4. Waiting for Payment overlay
          if (_rideStatus == 'waiting_payment') _buildWaitingPaymentSheet(),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    final cardBg = _isDarkMode ? const Color(0xFF1E293B) : AppColors.white;
    final textColor = _isDarkMode ? Colors.white : AppColors.textPrimary;

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        // Driver Info — tappable to open profile
        GestureDetector(
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => DriverProfileScreen(isDarkMode: _isDarkMode),
              ),
            );
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: cardBg,
              borderRadius: BorderRadius.circular(24),
              boxShadow: _isDarkMode ? [] : AppShadows.soft,
              border: _isDarkMode ? Border.all(color: Colors.white12) : null,
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: const BoxDecoration(
                    gradient: AppGradients.primaryButton,
                    shape: BoxShape.circle,
                  ),
                  child: _userPhoto != null
                      ? ClipOval(
                          child: Image.network(_userPhoto!, fit: BoxFit.cover),
                        )
                      : const Icon(
                          Icons.person,
                          size: 18,
                          color: AppColors.white,
                        ),
                ),
                const SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _userName ?? 'Driver',
                      style: GoogleFonts.inter(
                        color: textColor,
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                    Text(
                      'Elite Driver',
                      style: GoogleFonts.inter(
                        color: AppColors.primaryLight,
                        fontWeight: FontWeight.w600,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),

        // Theme toggle + Logout
        Row(
          children: [
            GestureDetector(
              onTap: _toggleTheme,
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: cardBg,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: _isDarkMode ? [] : AppShadows.soft,
                  border: _isDarkMode
                      ? Border.all(color: Colors.white12)
                      : null,
                ),
                child: Icon(
                  _isDarkMode
                      ? Icons.light_mode_rounded
                      : Icons.dark_mode_rounded,
                  color: _isDarkMode ? Colors.amber : Colors.blueGrey,
                  size: 20,
                ),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _handleLogout,
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: cardBg,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: _isDarkMode ? [] : AppShadows.soft,
                  border: _isDarkMode
                      ? Border.all(color: Colors.white12)
                      : null,
                ),
                child: Icon(
                  Icons.logout_rounded,
                  color: AppColors.error.withValues(alpha: 0.8),
                  size: 20,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildStatusCard() {
    final cardBg = _isDarkMode ? const Color(0xFF1E293B) : AppColors.white;
    final titleColor = _isDarkMode ? Colors.white : AppColors.textPrimary;
    final subtitleColor = _isDarkMode
        ? Colors.white70
        : AppColors.textSecondary;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(24),
        boxShadow: _isDarkMode ? [] : AppShadows.medium,
        border: _isDarkMode ? Border.all(color: Colors.white12) : null,
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _isOnline ? 'You are Online' : 'You are Offline',
                    style: GoogleFonts.inter(
                      color: titleColor,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _isOnline
                        ? 'Accepting rides now'
                        : 'Go online to start earning',
                    style: GoogleFonts.inter(
                      color: subtitleColor,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
              // Premium toggle
              GestureDetector(
                onTap: _toggleOnlineStatus,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  width: 56,
                  height: 32,
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    gradient: _isOnline ? AppGradients.primaryButton : null,
                    color: _isOnline
                        ? null
                        : (_isDarkMode
                              ? Colors.grey[700]
                              : AppColors.lightGrey),
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: _isOnline ? AppShadows.soft : [],
                  ),
                  child: AnimatedAlign(
                    duration: const Duration(milliseconds: 300),
                    alignment: _isOnline
                        ? Alignment.centerRight
                        : Alignment.centerLeft,
                    child: Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(
                        color: AppColors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.1),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    return Row(
      children: [
        Expanded(
          child: _buildStatItem(
            '₹${_todayEarnings.toStringAsFixed(0)}',
            'Today\'s Earnings',
            Icons.account_balance_wallet_outlined,
            AppColors.primaryLight,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _buildStatItem(
            '$_todayRides',
            'Today\'s Rides',
            Icons.directions_car_outlined,
            AppColors.info,
          ),
        ),
      ],
    );
  }

  Widget _buildStatItem(
    String value,
    String label,
    IconData icon,
    Color color,
  ) {
    final cardBg = _isDarkMode ? const Color(0xFF1E293B) : AppColors.white;
    final titleColor = _isDarkMode ? Colors.white : AppColors.textPrimary;
    final subtitleColor = _isDarkMode
        ? Colors.white70
        : AppColors.textSecondary;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(20),
        boxShadow: _isDarkMode ? [] : AppShadows.soft,
        border: _isDarkMode ? Border.all(color: Colors.white12) : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: color.withValues(alpha: _isDarkMode ? 0.2 : 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(height: 12),
          Text(
            value,
            style: GoogleFonts.inter(
              color: titleColor,
              fontSize: 22,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: GoogleFonts.inter(
              color: subtitleColor,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  /// Waiting for payment — matches Image 5 (clock icon, amber text, orange progress bar)
  Widget _buildWaitingPaymentSheet() {
    final sheetBg = _isDarkMode ? const Color(0xFF1E293B) : Colors.white;
    final borderCol = _isDarkMode
        ? const Color(0xFFE6A817).withValues(alpha: 0.3)
        : Colors.amber[200]!;

    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: sheetBg,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: borderCol),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.2),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_paidFare == null) ...[
              // Waiting state — Image 5
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: const Color(0xFFE6A817).withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.schedule_rounded,
                  color: Color(0xFFE6A817),
                  size: 32,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Waiting for Payment',
                style: GoogleFonts.inter(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFFE6A817),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Trip completed. Please wait while the rider\ncompletes the payment.',
                style: GoogleFonts.inter(
                  color: _isDarkMode ? Colors.white60 : Colors.grey[600],
                  fontSize: 13,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              // Orange linear progress bar
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: const LinearProgressIndicator(
                  minHeight: 6,
                  backgroundColor: Color(0xFF2A2A2A),
                  valueColor: AlwaysStoppedAnimation<Color>(Color(0xFFE6A817)),
                ),
              ),
            ] else ...[
              // Payment received state
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: const Color(0xFF4CAF50).withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_circle_rounded,
                  color: Color(0xFF4CAF50),
                  size: 36,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Payment Received! 🎉',
                style: GoogleFonts.inter(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFF4CAF50),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '₹${_paidFare!.toStringAsFixed(0)}',
                style: GoogleFonts.inter(
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                  color: _isDarkMode ? Colors.white : const Color(0xFF1B5E20),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Trip fare collected',
                style: GoogleFonts.inter(
                  color: _isDarkMode ? Colors.white60 : Colors.grey[600],
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 24),
              Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: const LinearGradient(
                    colors: [Color(0xFF2E7D32), Color(0xFF43A047)],
                  ),
                ),
                child: TextButton(
                  onPressed: _resetRideState,
                  style: TextButton.styleFrom(
                    minimumSize: const Size(double.infinity, 56),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: Text(
                    'Continue',
                    style: GoogleFonts.inter(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildIncomingRideSheet() {
    final ride = _currentRide ?? _pendingRide;
    if (ride == null) return const SizedBox.shrink();

    final sheetBg = _isDarkMode ? const Color(0xFF1E293B) : AppColors.white;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: sheetBg,
        borderRadius: BorderRadius.circular(20),
        border: _isDarkMode ? Border.all(color: Colors.white12) : null,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Status header icon + title
          _buildStatusHeader(),
          const SizedBox(height: 10),
          // ETA/Distance bar (for matched, arrived, in_progress)
          if (_rideStatus != 'pending' &&
              (_etaText.isNotEmpty || _distanceText.isNotEmpty))
            _buildEtaDistanceBar(),
          if (_rideStatus != 'pending' &&
              (_etaText.isNotEmpty || _distanceText.isNotEmpty))
            const SizedBox(height: 10),
          // Route details (pickup / drop)
          _buildRouteDetails(ride),
          // Fare card (only for pending)
          if (_rideStatus == 'pending' && ride['fare'] != null) ...[
            const SizedBox(height: 10),
            _buildFareCard(ride),
          ],
          // Rider info card (for matched, arrived, in_progress)
          if (_rideStatus != 'pending' && _riderName != null) ...[
            const SizedBox(height: 10),
            _buildRiderCard(),
          ],
          // Navigation info (for matched)
          if (_rideStatus == 'matched' && _distanceText.isNotEmpty) ...[
            const SizedBox(height: 10),
            _buildNavigatingInfo(),
          ],
          // Timer section (for arrived)
          if (_rideStatus == 'arrived') ...[
            const SizedBox(height: 10),
            _buildTimerSection(),
          ],
          const SizedBox(height: 12),
          // Action buttons
          _buildActionButtons(),
        ],
      ),
    );
  }

  Widget _buildStatusHeader() {
    IconData icon;
    String title;
    String subtitle;
    Color iconBgColor;

    final titleColor = _isDarkMode ? Colors.white : Colors.black87;
    final subtitleColor = _isDarkMode ? Colors.white60 : Colors.grey[600]!;

    switch (_rideStatus) {
      case 'pending':
        icon = Icons.local_taxi_rounded;
        title = 'New Ride Request';
        subtitle = 'A rider is waiting for you';
        iconBgColor = const Color(0xFF2196F3);
        break;
      case 'matched':
        icon = Icons.route_rounded;
        title = 'Ride Assigned!';
        subtitle = 'Navigate to pickup';
        iconBgColor = const Color(0xFF4CAF50);
        break;
      case 'arrived':
        icon = Icons.location_on_rounded;
        title = 'Reached Pickup';
        subtitle = 'Enter OTP to start trip';
        iconBgColor = const Color(0xFF4CAF50);
        break;
      case 'in_progress':
        icon = Icons.route_rounded;
        title = 'Trip in Progress';
        subtitle = 'Head to destination';
        iconBgColor = const Color(0xFF4CAF50);
        break;
      default:
        icon = Icons.info_outline;
        title = 'Ride Info';
        subtitle = '';
        iconBgColor = Colors.grey;
    }

    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: iconBgColor, shape: BoxShape.circle),
          child: Icon(icon, color: Colors.white, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.inter(
                  color: titleColor,
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (subtitle.isNotEmpty)
                Text(
                  subtitle,
                  style: GoogleFonts.inter(color: subtitleColor, fontSize: 12),
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// ETA & Distance bar matching Image 2 / Image 4
  Widget _buildEtaDistanceBar() {
    final cardBg = _isDarkMode ? const Color(0xFF0F172A) : Colors.grey[50];
    final borderCol = _isDarkMode ? Colors.white12 : Colors.grey[200]!;
    final labelColor = _isDarkMode ? Colors.white60 : Colors.grey[600]!;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderCol),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              children: [
                Text(
                  'ETA',
                  style: GoogleFonts.inter(
                    color: labelColor,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _etaText.isNotEmpty ? _etaText : '--',
                  style: GoogleFonts.inter(
                    color: const Color(0xFF4CAF50),
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          Container(width: 1, height: 30, color: borderCol),
          Expanded(
            child: Column(
              children: [
                Text(
                  'DISTANCE',
                  style: GoogleFonts.inter(
                    color: labelColor,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _distanceText.isNotEmpty ? _distanceText : '--',
                  style: GoogleFonts.inter(
                    color: const Color(0xFF2196F3),
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Navigating to Pickup info bar (Image 2)
  Widget _buildNavigatingInfo() {
    final cardBg = _isDarkMode
        ? const Color(0xFF0F172A).withValues(alpha: 0.7)
        : Colors.grey[100];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: _isDarkMode ? Colors.white12 : Colors.grey[300]!,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.local_taxi_rounded,
            color: Color(0xFF4CAF50),
            size: 16,
          ),
          const SizedBox(width: 6),
          Text(
            'Navigating to Pickup ($_distanceText)',
            style: GoogleFonts.inter(
              color: _isDarkMode ? Colors.white70 : Colors.black87,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRiderCard() {
    final cardBg = _isDarkMode ? const Color(0xFF0F172A) : Colors.grey[50];
    final borderCol = _isDarkMode ? Colors.white12 : Colors.grey[200]!;
    final nameColor = _isDarkMode ? Colors.white : Colors.black87;
    final labelColor = _isDarkMode ? Colors.white60 : Colors.grey[600]!;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderCol),
      ),
      child: Row(
        children: [
          // Rider name section
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'RIDER',
                  style: GoogleFonts.inter(
                    color: labelColor,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _riderName ?? 'Rider',
                  style: GoogleFonts.inter(
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                    color: nameColor,
                  ),
                ),
              ],
            ),
          ),
          // Twilio masked call button
          GestureDetector(
            onTap: (_rideId != null)
                ? () async {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Connecting call securely...'),
                        backgroundColor: Colors.green,
                        behavior: SnackBarBehavior.floating,
                        margin: EdgeInsets.only(
                          top: 10,
                          left: 16,
                          right: 16,
                          bottom: 600,
                        ),
                      ),
                    );
                    final result = await MapService.initiateCallMask(
                      _rideId!,
                      'driver',
                    );
                    if (mounted) {
                      final message = result?['message'] ?? 'Call failed';
                      final success = result?['success'] == true;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(message),
                          backgroundColor: success ? Colors.green : Colors.red,
                          behavior: SnackBarBehavior.floating,
                          margin: const EdgeInsets.only(
                            top: 10,
                            left: 16,
                            right: 16,
                            bottom: 600,
                          ),
                        ),
                      );
                    }
                  }
                : null,
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                gradient: (_rideId != null)
                    ? const LinearGradient(
                        colors: [Color(0xFF2E7D32), Color(0xFF66BB6A)],
                      )
                    : null,
                color: (_rideId != null) ? null : Colors.grey[300],
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.call_rounded,
                color: (_rideId != null) ? Colors.white : Colors.grey,
                size: 20,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteDetails(Map<dynamic, dynamic> ride) {
    final pickupName = ride['pickupName']?.toString() ?? 'Pickup Location';
    final dropName = ride['dropName']?.toString() ?? 'Drop Location';
    final cardBg = _isDarkMode ? const Color(0xFF0F172A) : Colors.grey[50];
    final borderCol = _isDarkMode ? Colors.white12 : Colors.grey[200]!;
    final textColor = _isDarkMode
        ? Colors.white.withValues(alpha: 0.9)
        : Colors.black87;
    final labelColor = _isDarkMode ? Colors.white60 : Colors.grey[600]!;
    final isTrip = _rideStatus == 'in_progress';

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderCol),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Pickup row
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: isTrip ? Colors.grey : const Color(0xFF2196F3),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'PICKUP',
                style: GoogleFonts.inter(
                  color: isTrip ? Colors.grey : labelColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 18, top: 2, bottom: 8),
            child: Text(
              pickupName,
              style: GoogleFonts.inter(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: isTrip ? Colors.grey : textColor,
                decoration: isTrip ? TextDecoration.lineThrough : null,
                decorationColor: Colors.grey,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          // Drop row
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: const Color(0xFF4CAF50),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'DROP-OFF',
                style: GoogleFonts.inter(
                  color: labelColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 18, top: 2),
            child: Text(
              dropName,
              style: GoogleFonts.inter(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: textColor,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFareCard(Map<dynamic, dynamic> ride) {
    final fare = ride['fare'];
    final dividerCol = _isDarkMode ? Colors.white12 : Colors.grey[200]!;
    final labelColor = _isDarkMode ? Colors.white60 : Colors.grey[600]!;

    return Column(
      children: [
        Container(height: 1, color: dividerCol),
        const SizedBox(height: 14),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Estimated Fare',
              style: GoogleFonts.inter(
                fontSize: 14,
                color: labelColor,
                fontWeight: FontWeight.w500,
              ),
            ),
            Text(
              '₹$fare',
              style: GoogleFonts.inter(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                color: const Color(0xFF4CAF50),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildTimerSection() {
    if (_otpTimer == null || !_otpTimer!.isActive)
      return const SizedBox.shrink();
    final progress = _otpTimeRemaining / 300.0;
    final isUrgent = _otpTimeRemaining < 60;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isUrgent
              ? [const Color(0xFFFDE0DC), const Color(0xFFFCE4EC)]
              : [const Color(0xFFE3F2FD), const Color(0xFFE8EAF6)],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isUrgent ? const Color(0xFFEF9A9A) : const Color(0xFF90CAF9),
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 44,
            height: 44,
            child: Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 44,
                  height: 44,
                  child: CircularProgressIndicator(
                    value: progress,
                    strokeWidth: 4,
                    backgroundColor: Colors.grey[300],
                    valueColor: AlwaysStoppedAnimation(
                      isUrgent ? Colors.red : const Color(0xFF1565C0),
                    ),
                  ),
                ),
                Text(
                  _formatTime(_otpTimeRemaining),
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: isUrgent ? Colors.red : const Color(0xFF1565C0),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isUrgent ? 'Hurry! Time running out' : 'Waiting for rider',
                  style: GoogleFonts.inter(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                    color: isUrgent ? Colors.red[700] : const Color(0xFF1565C0),
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  'Ride auto-cancels when timer expires',
                  style: GoogleFonts.inter(
                    fontSize: 10,
                    color: Colors.grey[600],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons() {
    if (_rideStatus == 'pending') {
      // Image 1: Decline (red outline) + Accept Ride (green fill)
      return Row(
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                color: _isDarkMode
                    ? Colors.red.withValues(alpha: 0.15)
                    : Colors.red[50],
                border: Border.all(color: Colors.red.withValues(alpha: 0.4)),
              ),
              child: TextButton(
                onPressed: _isDeclining ? null : _declineRide,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: _isDeclining
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.red,
                        ),
                      )
                    : Text(
                        'Decline',
                        style: GoogleFonts.inter(
                          color: Colors.red,
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                gradient: const LinearGradient(
                  colors: [Color(0xFF2E7D32), Color(0xFF43A047)],
                ),
              ),
              child: TextButton(
                onPressed: _isAccepting ? null : _acceptRide,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: _isAccepting
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : Text(
                        'Accept Ride',
                        style: GoogleFonts.inter(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
              ),
            ),
          ),
        ],
      );
    }
    if (_rideStatus == 'matched') {
      // Image 2: "Reached Rider Location" green button with checkmark
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(
            colors: [Color(0xFF2E7D32), Color(0xFF43A047)],
          ),
        ),
        child: TextButton.icon(
          onPressed: _isArriving ? null : _handleArriveAtPickup,
          icon: _isArriving
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(
                    color: Colors.white,
                    strokeWidth: 2,
                  ),
                )
              : const Icon(
                  Icons.check_circle_rounded,
                  color: Colors.white,
                  size: 20,
                ),
          label: Text(
            'Reached Rider Location',
            style: GoogleFonts.inter(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
          style: TextButton.styleFrom(
            minimumSize: const Size(double.infinity, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
        ),
      );
    }
    if (_rideStatus == 'arrived') {
      // OTP entry button
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(
            colors: [Color(0xFF1B5E20), Color(0xFF43A047)],
          ),
        ),
        child: TextButton.icon(
          onPressed: _showOtpDialog,
          icon: const Icon(Icons.pin_rounded, color: Colors.white, size: 20),
          label: Text(
            'Enter OTP & Start Ride',
            style: GoogleFonts.inter(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
          style: TextButton.styleFrom(
            minimumSize: const Size(double.infinity, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
        ),
      );
    }
    if (_rideStatus == 'in_progress') {
      // Image 4: "Complete Trip" green button
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(
            colors: [Color(0xFF2E7D32), Color(0xFF43A047)],
          ),
        ),
        child: TextButton.icon(
          onPressed: _handleCompleteRide,
          icon: const Icon(Icons.flag_rounded, color: Colors.white, size: 20),
          label: Text(
            'Complete Trip',
            style: GoogleFonts.inter(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
          style: TextButton.styleFrom(
            minimumSize: const Size(double.infinity, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  /// Show OTP dialog matching Image 3 dark theme
  void _showOtpDialog() {
    _otpController.clear();
    final sheetBg = _isDarkMode ? const Color(0xFF1E293B) : Colors.white;
    final titleColor = _isDarkMode ? Colors.white : Colors.black87;
    final subtitleColor = _isDarkMode ? Colors.white60 : Colors.grey[600]!;
    final inputBg = _isDarkMode ? const Color(0xFF0F172A) : Colors.grey[50]!;
    final inputBorder = _isDarkMode
        ? const Color(0xFF2196F3)
        : const Color(0xFF1565C0);
    final inputTextColor = _isDarkMode
        ? Colors.white70
        : const Color(0xFF1565C0);
    final cancelBg = _isDarkMode ? Colors.white12 : Colors.grey[200]!;
    final cancelTextColor = _isDarkMode ? Colors.white70 : Colors.grey[700]!;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Container(
          decoration: BoxDecoration(
            color: sheetBg,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            border: _isDarkMode
                ? const Border(top: BorderSide(color: Colors.white12))
                : null,
          ),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Enter OTP',
                style: GoogleFonts.inter(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: titleColor,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Ask the rider for the 4-digit OTP to start the trip.',
                style: GoogleFonts.inter(fontSize: 12, color: subtitleColor),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _otpController,
                keyboardType: TextInputType.number,
                maxLength: 4,
                textAlign: TextAlign.center,
                autofocus: true,
                style: GoogleFonts.inter(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 16,
                  color: inputTextColor,
                ),
                decoration: InputDecoration(
                  hintText: '0 0 0 0',
                  hintStyle: GoogleFonts.inter(
                    fontSize: 28,
                    color: _isDarkMode ? Colors.white24 : Colors.grey[300],
                    letterSpacing: 16,
                  ),
                  counterText: '',
                  filled: true,
                  fillColor: inputBg,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: inputBorder),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(
                      color: inputBorder.withValues(alpha: 0.5),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: inputBorder, width: 2),
                  ),
                  contentPadding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        color: cancelBg,
                      ),
                      child: TextButton(
                        onPressed: () => Navigator.pop(ctx),
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: Text(
                          'Cancel',
                          style: GoogleFonts.inter(
                            color: cancelTextColor,
                            fontWeight: FontWeight.w600,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        gradient: const LinearGradient(
                          colors: [Color(0xFF2E7D32), Color(0xFF43A047)],
                        ),
                      ),
                      child: TextButton(
                        onPressed: () async {
                          final otp = _otpController.text.trim();
                          if (otp.length != 4) {
                            ScaffoldMessenger.of(ctx).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Please enter a valid 4-digit OTP',
                                ),
                                backgroundColor: Colors.red,
                              ),
                            );
                            return;
                          }
                          Navigator.pop(ctx);
                          await _handleStartRide(otp);
                        },
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: Text(
                          'Start Trip',
                          style: GoogleFonts.inter(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }

  String _formatTime(int seconds) {
    final int min = seconds ~/ 60;
    final int sec = seconds % 60;
    return '$min:${sec.toString().padLeft(2, '0')}';
  }
}
