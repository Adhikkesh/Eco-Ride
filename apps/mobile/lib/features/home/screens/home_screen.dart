import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/gestures.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:location/location.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../../core/services/map_service.dart';
import '../../auth/screens/login_screen.dart';
import '../../payment/screens/payment_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final Completer<GoogleMapController> _controller = Completer<GoogleMapController>();
  final Location _location = Location();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final TextEditingController _pickupController = TextEditingController();
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _suggestions = [];
  List<Map<String, dynamic>> _pickupSuggestions = [];
  bool _isSearchingDestination = false;
  bool _isSearchingPickup = false;
  
  // Default to Coimbatore as seen in screenshot, or generic
  static const CameraPosition _kDefaultLocation = CameraPosition(
    target: LatLng(11.0168, 76.9558), // Coimbatore
    zoom: 14.4746,
  );

  bool _isLoading = true;
  LatLng? _currentPosition;
  LatLng? _pickupPosition;
  LatLng? _destinationPosition;
  Set<Marker> _markers = {};
  Set<Polyline> _polylines = {};
  String? _userName;
  String? _userEmail;
  String? _userPhoto;
    bool _ignoreSearchChange = false;
    // State for estimates
    Map<String, dynamic>? _estimateData;
  bool _isSearchingForDriver = false;

  // Ride lifecycle state
  String? _rideId;
  String _rideStatus = 'idle'; // idle, searching, matched, arrived, on_trip, completed, error
  String? _driverName;
  String? _driverPhone;
  String? _otp;
  bool _showOtp = false;
  StreamSubscription<DatabaseEvent>? _rideStatusSubscription;
  Timer? _otpPollTimer;
  final FirebaseDatabase _rtdb = FirebaseDatabase.instance;

  // Driver live tracking state
  String? _driverId;
  LatLng? _driverPosition;
  double _driverHeading = 0;
  StreamSubscription<DatabaseEvent>? _driverLocationSubscription;
  LatLng? _lastDriverWrittenPosition; // For throttling marker updates
  DateTime _lastRouteFetchTime = DateTime(2000); // For throttling route API calls
  BitmapDescriptor? _carIcon; // Custom car icon for driver marker
  String _cameraFittedForPhase = ''; // Track which ride phase camera was fitted for

    @override
  void initState() {
    super.initState();
    _loadUserData();
    _getCurrentLocation();
    _checkActiveRide();
    _createCarIcon();
    _pickupController.addListener(() => _onSearchChanged(isPickup: true));
    _searchController.addListener(() => _onSearchChanged(isPickup: false));
  }

  @override
  void dispose() {
    _rideStatusSubscription?.cancel();
    _driverLocationSubscription?.cancel();
    _otpPollTimer?.cancel();
    _debounce?.cancel();
    _pickupController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  /// Check for existing active ride on app launch
  Future<void> _checkActiveRide() async {
    try {
      final result = await MapService.getActiveRide();
      if (result != null && result['success'] == true && result['rideId'] != null) {
        final status = result['status'] as String?;
        debugPrint('HomeScreen: Found ride ${result['rideId']} with status: $status');

        // Only restore truly active rides
        if (status == null ||
            status == 'COMPLETED' ||
            status == 'CANCELLED' ||
            status == 'NO_DRIVERS') {
          debugPrint('HomeScreen: Ride is not active ($status), skipping restore');
          return;
        }

        if (mounted) {
          final driverId = result['driverId'] as String?;
          setState(() {
            _rideId = result['rideId'];
            _isSearchingForDriver = true;
            _driverName = result['driverName'] ?? 'Driver';
            _driverPhone = result['driverPhone'] ?? '';
            _driverId = driverId;

            // Set ride status based on actual backend status
            if (status == 'IN_PROGRESS') {
              _rideStatus = 'on_trip';
            } else if (status == 'MATCHED') {
              _rideStatus = 'matched';
            } else {
              _rideStatus = 'searching';
            }
          });
          _startRideStatusListener(_rideId!);
          if (_rideStatus == 'matched') {
            _startOtpPolling();
          }
          // Start tracking driver's live position
          if (driverId != null) {
            _startDriverLocationListener(driverId);
          }
        }
      }
    } catch (e) {
      debugPrint('HomeScreen: Error checking active ride: $e');
    }
  }

  Future<void> _useCurrentLocationForPickup() async {
    setState(() {
      _pickupController.text = "Getting location...";
      _ignoreSearchChange = true;
    });

    try {
      // Race explicitly against a timeout to ensure UI doesn't freeze
      await _getCurrentLocation().timeout(const Duration(seconds: 5));
    } catch (e) {
      debugPrint('HomeScreen: Location fetch timed out or failed: $e');
    }
    
    if (_currentPosition != null && mounted) {
      setState(() {
        _pickupPosition = _currentPosition;
        _pickupController.text = "Current Location";
        _pickupSuggestions = []; // Clear suggestions
        _ignoreSearchChange = true; // Prevent search trigger
        
        // Add marker
        _markers.removeWhere((m) => m.markerId.value == 'pickup');
        _markers.add(
          Marker(
            markerId: const MarkerId('pickup'),
            position: _pickupPosition!,
            infoWindow: const InfoWindow(title: 'Pickup: Current Location'),
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
          ),
        );
      });
      
      // Reset flag after small delay to allow typing again if user wants to change
      Future.delayed(const Duration(milliseconds: 500), () => _ignoreSearchChange = false);

      _updateCamera();
    } else {
      if (mounted) {
         setState(() {
           _pickupController.text = ""; // Clear "Getting location..."
           _ignoreSearchChange = false;
         });
         ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Unable to fetch current location quickly. Please try again or search manually.')),
        );
      }
    }
  }

  Future<void> _handleRequestRide() async {
    if (_estimateData == null || _pickupPosition == null || _destinationPosition == null) return;

    setState(() {
      _isSearchingForDriver = true;
      _rideStatus = 'searching';
    });

    // Extract distance/duration from backend estimate fields
    // Backend returns: distance_km (string like "26.7"), details.duration_s (int), eta_min (int)
    double distanceKm = 0.0;
    if (_estimateData!['distance_km'] != null) {
      distanceKm = double.tryParse(_estimateData!['distance_km'].toString()) ?? 0.0;
    }
    double durationMin = 0.0;
    if (_estimateData!['eta_min'] != null) {
      durationMin = (_estimateData!['eta_min'] as num).toDouble();
    }

    final result = await MapService.requestRide(
      pickup: _pickupPosition!,
      drop: _destinationPosition!,
      fare: (_estimateData!['fare'] as num).toDouble(),
      distance: distanceKm,
      duration: durationMin,
      polyline: _estimateData!['polyline'] ?? '',
    );

    if (mounted) {
      if (result != null && result['rideId'] != null) {
        final rideId = result['rideId'] as String;
        debugPrint('HomeScreen: Ride requested! ID: $rideId');
        setState(() {
          _rideId = rideId;
          _rideStatus = 'searching';
          if (result['driverName'] != null) _driverName = result['driverName'];
          if (result['driverPhone'] != null) _driverPhone = result['driverPhone'];
        });
        _startRideStatusListener(rideId);
      } else {
        setState(() {
          _isSearchingForDriver = false;
          _rideStatus = 'idle';
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No drivers available right now. Please try again in a moment.'),
            backgroundColor: Colors.orange,
            duration: Duration(seconds: 4),
          ),
        );
      }
    }
  }

  /// Start listening to ride status changes via RTDB
  void _startRideStatusListener(String rideId) {
    _rideStatusSubscription?.cancel();
    final rideRef = _rtdb.ref('rides/$rideId');
    debugPrint('HomeScreen: Listening to rides/$rideId for status changes');

    _rideStatusSubscription = rideRef.onValue.listen((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>?;
      if (data == null) return;

      final status = data['status'] as String?;
      debugPrint('HomeScreen: RTDB ride status update: $status');

      if (!mounted) return;

      setState(() {
        // ALWAYS try to update driver details if they are present in the payload
        _driverName = data['driverName'] as String? ?? _driverName ?? 'Driver';
        _driverPhone = data['driverPhone'] as String? ?? _driverPhone ?? '';

        // Capture driverId for live location tracking
        final newDriverId = data['driverId'] as String?;
        if (newDriverId != null && newDriverId != _driverId) {
          _driverId = newDriverId;
        }

        if (status == 'MATCHED' || status == 'PENDING_ACCEPTANCE') {
          if (_rideStatus == 'searching' || _rideStatus == 'idle') {
            _rideStatus = status == 'MATCHED' ? 'matched' : 'searching';
          }
          if (status == 'MATCHED') {
            _startOtpPolling();
            // Start tracking driver's live position
            if (_driverId != null) {
              _startDriverLocationListener(_driverId!);
            }
          }
        } else if (status == 'ARRIVED') {
          _rideStatus = 'arrived';
        } else if (status == 'IN_PROGRESS') {
          _rideStatus = 'on_trip';
          _otpPollTimer?.cancel();
          _showOtp = false;
          // Remove pickup marker when trip starts — driver already picked up rider
          _markers.removeWhere((m) => m.markerId.value == 'pickup');
          // Remove old route preview polylines
          _polylines.removeWhere((p) => p.polylineId.value == 'route');
          _polylines.removeWhere((p) => p.polylineId.value == 'driver_to_pickup');
          // Reset camera fit so it auto-fits for the new phase
          _cameraFittedForPhase = '';
        } else if (status == 'COMPLETED') {
          _rideStatus = 'completed';
          // Save ride info before resetting
          final completedRideId = _rideId;
          final fare = (data['fare'] as num?)?.toDouble() ?? 100.0;
          _resetRideState();
          // Navigate to payment screen
          if (completedRideId != null) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => PaymentScreen(
                    rideId: completedRideId,
                    fare: fare,
                  ),
                ),
              ).then((paid) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(paid == true ? 'Payment successful! 🎉' : 'Trip completed! 🎉'),
                      backgroundColor: Colors.green,
                    ),
                  );
                }
              });
            });
          }
        } else if (status == 'CANCELLED') {
          final reason = data['cancelReason'] as String?;
          _resetRideState();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(reason == 'TIMEOUT' ? 'Ride cancelled (no response)' : 'Ride was cancelled'),
              backgroundColor: Colors.orange,
            ),
          );
        } else if (status == 'NO_DRIVERS') {
          _rideStatus = 'error';
          _resetRideState();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('No drivers available. Please try again.'),
              backgroundColor: Colors.red,
            ),
          );
        } else if (status == 'SEARCHING') {
          // Driver declined, system re-matching
          _rideStatus = 'searching';
        }
      });
    });
  }

  /// Start polling for OTP availability
  void _startOtpPolling() {
    _otpPollTimer?.cancel();
    if (_rideId == null) return;
    debugPrint('HomeScreen: Starting OTP polling for ride $_rideId');

    // Fetch OTP immediately on match
    _fetchOtp();

    // Then poll every 10 seconds if not yet available
    _otpPollTimer = Timer.periodic(const Duration(seconds: 10), (timer) async {
      if (_rideId == null || (_rideStatus != 'matched' && _rideStatus != 'arrived')) {
        timer.cancel();
        return;
      }
      if (_showOtp && _otp != null) {
        timer.cancel(); // Already have OTP
        return;
      }
      _fetchOtp();
    });
  }

  /// Fetch OTP from backend
  Future<void> _fetchOtp() async {
    if (_rideId == null) return;
    final result = await MapService.getOtp(_rideId!);
    if (result != null && result['success'] == true && mounted) {
      if (result['otpAvailable'] == true && result['otp'] != null) {
        setState(() {
          _otp = result['otp'].toString();
          _showOtp = true;
        });
        _otpPollTimer?.cancel();
        debugPrint('HomeScreen: OTP received: $_otp');
      }
    }
  }

  /// Cancel the current ride
  Future<void> _cancelCurrentRide() async {
    if (_rideId == null) {
      setState(() {
        _isSearchingForDriver = false;
        _rideStatus = 'idle';
      });
      return;
    }

    final result = await MapService.cancelRide(_rideId!);
    if (mounted) {
      _resetRideState();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result != null ? 'Ride cancelled' : 'Error cancelling ride'),
        ),
      );
    }
  }

  /// Reset all ride-related state
  void _resetRideState() {
    _rideStatusSubscription?.cancel();
    _rideStatusSubscription = null;
    _driverLocationSubscription?.cancel();
    _driverLocationSubscription = null;
    _otpPollTimer?.cancel();
    setState(() {
      _rideId = null;
      _rideStatus = 'idle';
      _isSearchingForDriver = false;
      _driverName = null;
      _driverPhone = null;
      _otp = null;
      _showOtp = false;
      _estimateData = null;
      // Clear driver tracking state
      _driverId = null;
      _driverPosition = null;
      _driverHeading = 0;
      _lastDriverWrittenPosition = null;
      _cameraFittedForPhase = '';
      // Clear ALL markers and polylines
      _markers.clear();
      _polylines.clear();
      // Clear pickup/destination positions and search text
      _pickupPosition = null;
      _destinationPosition = null;
      _pickupController.clear();
      _searchController.clear();
    });
  }

  /// Haversine distance between two LatLng points in meters
  double _haversineDistance(LatLng a, LatLng b) {
    const R = 6371e3; // Earth radius in meters
    final dLat = _toRad(b.latitude - a.latitude);
    final dLng = _toRad(b.longitude - a.longitude);
    final aCalc = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_toRad(a.latitude)) * math.cos(_toRad(b.latitude)) *
        math.sin(dLng / 2) * math.sin(dLng / 2);
    return R * 2 * math.atan2(math.sqrt(aCalc), math.sqrt(1 - aCalc));
  }

  double _toRad(double deg) => deg * math.pi / 180;

  /// Start listening to driver's live position from RTDB
  void _startDriverLocationListener(String driverId) {
    _driverLocationSubscription?.cancel();
    _lastDriverWrittenPosition = null;

    final driverRef = _rtdb.ref('drivers-online/$driverId');
    debugPrint('HomeScreen: Starting driver location tracking for $driverId');

    _driverLocationSubscription = driverRef.onValue.listen((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>?;
      if (data == null) return;

      final lat = (data['lat'] as num?)?.toDouble();
      final lng = (data['lng'] as num?)?.toDouble();
      final heading = (data['heading'] as num?)?.toDouble() ?? 0;

      if (lat == null || lng == null) return;

      final newPosition = LatLng(lat, lng);

      // Throttle: only update if moved more than 10 meters
      if (_lastDriverWrittenPosition != null) {
        final distance = _haversineDistance(_lastDriverWrittenPosition!, newPosition);
        if (distance < 10) return;
      }

      _lastDriverWrittenPosition = newPosition;

      if (!mounted) return;

      setState(() {
        _driverPosition = newPosition;
        _driverHeading = heading;

        // Update or add driver car marker
        _markers.removeWhere((m) => m.markerId.value == 'driver');
        _markers.add(
          Marker(
            markerId: const MarkerId('driver'),
            position: newPosition,
            rotation: heading,
            anchor: const Offset(0.5, 0.5),
            flat: true,
            icon: _carIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
            infoWindow: InfoWindow(title: _driverName ?? 'Driver'),
            zIndex: 10,
          ),
        );
      });

      // Fetch route polylines on first position update or when ride status changes
      _fetchDriverRoutes();

      // Auto-fit camera ONCE per ride phase (don't override user zoom/pan)
      if (_cameraFittedForPhase != _rideStatus) {
        _cameraFittedForPhase = _rideStatus;
        _fitCameraToDriverAndDestination();
      }

      debugPrint('HomeScreen: Driver at (${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}) heading: ${heading.toStringAsFixed(0)}°');
    });
  }

  /// Fetch and display route polylines based on current ride status
  Future<void> _fetchDriverRoutes() async {
    if (_driverPosition == null) return;

    // Throttle: at most once every 5 seconds to avoid excessive Directions API calls
    final now = DateTime.now();
    if (now.difference(_lastRouteFetchTime).inSeconds < 5) return;
    _lastRouteFetchTime = now;

    try {
      if (_rideStatus == 'matched' || _rideStatus == 'arrived') {
        // Show driver → pickup route (blue)
        if (_pickupPosition != null) {
          final result = await MapService.getDirections(_driverPosition!, _pickupPosition!);
          if (result != null && mounted) {
            final points = result['points'] as List<LatLng>;
            setState(() {
              _polylines.removeWhere((p) => p.polylineId.value == 'driver_to_pickup');
              _polylines.removeWhere((p) => p.polylineId.value == 'pickup_to_destination');
              _polylines.add(
                Polyline(
                  polylineId: const PolylineId('driver_to_pickup'),
                  points: points,
                  color: const Color(0xFF2196F3), // Blue
                  width: 5,
                  jointType: JointType.round,
                  startCap: Cap.roundCap,
                  endCap: Cap.roundCap,
                ),
              );
            });
          }
        }
        // Also show pickup → destination route (green) if destination is set
        if (_pickupPosition != null && _destinationPosition != null) {
          final result = await MapService.getDirections(_pickupPosition!, _destinationPosition!);
          if (result != null && mounted) {
            final points = result['points'] as List<LatLng>;
            setState(() {
              _polylines.removeWhere((p) => p.polylineId.value == 'pickup_to_destination');
              _polylines.add(
                Polyline(
                  polylineId: const PolylineId('pickup_to_destination'),
                  points: points,
                  color: const Color(0xFF4CAF50), // Green
                  width: 4,
                  jointType: JointType.round,
                  startCap: Cap.roundCap,
                  endCap: Cap.roundCap,
                  patterns: [PatternItem.dash(20), PatternItem.gap(10)],
                ),
              );
            });
          }
        }
      } else if (_rideStatus == 'on_trip') {
        // Show driver → destination route (green, solid)
        if (_destinationPosition != null) {
          final result = await MapService.getDirections(_driverPosition!, _destinationPosition!);
          if (result != null && mounted) {
            final points = result['points'] as List<LatLng>;
            setState(() {
              _polylines.removeWhere((p) => p.polylineId.value == 'driver_to_pickup');
              _polylines.removeWhere((p) => p.polylineId.value == 'pickup_to_destination');
              _polylines.add(
                Polyline(
                  polylineId: const PolylineId('pickup_to_destination'),
                  points: points,
                  color: const Color(0xFF4CAF50), // Green
                  width: 5,
                  jointType: JointType.round,
                  startCap: Cap.roundCap,
                  endCap: Cap.roundCap,
                ),
              );
            });
          }
        }
      }
    } catch (e) {
      debugPrint('HomeScreen: Error fetching driver routes: $e');
    }
  }

  /// Fit camera to show driver position and relevant destination
  Future<void> _fitCameraToDriverAndDestination() async {
    if (_driverPosition == null) return;

    try {
      final controller = await _controller.future;
      final points = <LatLng>[_driverPosition!];

      if ((_rideStatus == 'matched' || _rideStatus == 'arrived') && _pickupPosition != null) {
        points.add(_pickupPosition!);
      }
      if (_rideStatus == 'on_trip' && _destinationPosition != null) {
        points.add(_destinationPosition!);
      }

      if (points.length < 2) {
        controller.animateCamera(CameraUpdate.newLatLngZoom(_driverPosition!, 16));
        return;
      }

      double minLat = points[0].latitude, maxLat = points[0].latitude;
      double minLng = points[0].longitude, maxLng = points[0].longitude;
      for (final p in points) {
        if (p.latitude < minLat) minLat = p.latitude;
        if (p.latitude > maxLat) maxLat = p.latitude;
        if (p.longitude < minLng) minLng = p.longitude;
        if (p.longitude > maxLng) maxLng = p.longitude;
      }

      final bounds = LatLngBounds(
        southwest: LatLng(minLat, minLng),
        northeast: LatLng(maxLat, maxLng),
      );

      controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 100));
    } catch (e) {
      debugPrint('HomeScreen: Error fitting camera: $e');
    }
  }

  /// Create a custom car icon from canvas
  Future<void> _createCarIcon() async {
    try {
      const double size = 48;
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);

      // Car body
      final bodyPaint = Paint()..color = const Color(0xFF22C55E);
      final shadowPaint = Paint()..color = const Color(0xFF16A34A);

      // Shadow
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.2, size * 0.15, size * 0.6, size * 0.75),
          const Radius.circular(6),
        ),
        shadowPaint,
      );

      // Main body
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.22, size * 0.12, size * 0.56, size * 0.72),
          const Radius.circular(5),
        ),
        bodyPaint,
      );

      // Roof / windshield
      final roofPaint = Paint()..color = const Color(0xFF86EFAC);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.28, size * 0.28, size * 0.44, size * 0.3),
          const Radius.circular(3),
        ),
        roofPaint,
      );

      // Front lights
      final lightPaint = Paint()..color = Colors.white;
      canvas.drawCircle(Offset(size * 0.32, size * 0.18), 2, lightPaint);
      canvas.drawCircle(Offset(size * 0.68, size * 0.18), 2, lightPaint);

      // Rear lights
      final rearPaint = Paint()..color = const Color(0xFFEF4444);
      canvas.drawCircle(Offset(size * 0.32, size * 0.8), 2, rearPaint);
      canvas.drawCircle(Offset(size * 0.68, size * 0.8), 2, rearPaint);

      // Wheels
      final wheelPaint = Paint()..color = const Color(0xFF1F2937);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.14, size * 0.3, size * 0.1, size * 0.18),
          const Radius.circular(2),
        ),
        wheelPaint,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.76, size * 0.3, size * 0.1, size * 0.18),
          const Radius.circular(2),
        ),
        wheelPaint,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.14, size * 0.58, size * 0.1, size * 0.18),
          const Radius.circular(2),
        ),
        wheelPaint,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(size * 0.76, size * 0.58, size * 0.1, size * 0.18),
          const Radius.circular(2),
        ),
        wheelPaint,
      );

      final picture = recorder.endRecording();
      final img = await picture.toImage(size.toInt(), size.toInt());
      final byteData = await img.toByteData(format: ui.ImageByteFormat.png);

      if (byteData != null && mounted) {
        setState(() {
          _carIcon = BitmapDescriptor.bytes(byteData.buffer.asUint8List());
        });
      }
    } catch (e) {
      debugPrint('HomeScreen: Error creating car icon: $e');
    }
  }

  Widget _buildSearchingSheet() {
    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.15),
              blurRadius: 15,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Compact status row
            if (_rideStatus == 'searching')
              Row(
                children: [
                  const SizedBox(
                    width: 24, height: 24,
                    child: CircularProgressIndicator(color: Colors.green, strokeWidth: 3),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Contacting nearby drivers...',
                      style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              )
            else ...[
              // Title row with icon
              Row(
                children: [
                  Icon(
                    _rideStatus == 'on_trip' ? Icons.directions_car : Icons.check_circle,
                    color: _rideStatus == 'on_trip' ? Colors.blue : Colors.green,
                    size: 28,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _rideStatus == 'matched'
                              ? 'Driver Found! 🎉'
                              : _rideStatus == 'arrived'
                                  ? 'Driver Arrived! 📍'
                                  : _rideStatus == 'on_trip'
                                      ? 'Trip In Progress 🚗'
                                      : 'Finding driver...',
                          style: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w600),
                        ),
                        Text(
                          _rideStatus == 'matched'
                              ? '${_driverName ?? "Driver"} is on the way'
                              : _rideStatus == 'arrived'
                                  ? '${_driverName ?? "Driver"} is waiting'
                                  : _rideStatus == 'on_trip'
                                      ? 'Enjoy your ride!'
                                      : '',
                          style: GoogleFonts.inter(color: Colors.grey[600], fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],

            // Driver Info Card
            if ((_rideStatus == 'matched' || _rideStatus == 'arrived' || _rideStatus == 'on_trip') && _driverName != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: AppShadows.soft,
                ),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: const BoxDecoration(
                        gradient: AppGradients.primaryButton,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.person, color: AppColors.white, size: 22),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _driverName ?? 'Driver',
                            style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.textPrimary),
                          ),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Icon(Icons.phone_outlined, size: 14, color: AppColors.textSecondary),
                              const SizedBox(width: 4),
                              Text(
                                (_driverPhone != null && _driverPhone!.isNotEmpty)
                                    ? _driverPhone!
                                    : 'Fetching...',
                                style: GoogleFonts.inter(
                                  color: AppColors.textSecondary,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    // Call button — always visible
                    GestureDetector(
                      onTap: (_driverPhone != null && _driverPhone!.isNotEmpty)
                          ? () async {
                              final uri = Uri(scheme: 'tel', path: _driverPhone!);
                              if (await canLaunchUrl(uri)) {
                                await launchUrl(uri);
                              }
                            }
                          : null,
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          gradient: (_driverPhone != null && _driverPhone!.isNotEmpty)
                              ? AppGradients.primaryButton
                              : null,
                          color: (_driverPhone != null && _driverPhone!.isNotEmpty)
                              ? null
                              : AppColors.lightGrey,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.call_rounded,
                          color: (_driverPhone != null && _driverPhone!.isNotEmpty)
                              ? AppColors.white
                              : AppColors.grey,
                          size: 20,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // OTP Display
            if (_showOtp && _otp != null && (_rideStatus == 'matched' || _rideStatus == 'arrived')) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 24),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.green.withOpacity(0.3)),
                ),
                child: Column(
                  children: [
                    Text(
                      'Share this OTP with your driver',
                      style: GoogleFonts.inter(color: Colors.green[700], fontSize: 12),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _otp!,
                      style: GoogleFonts.inter(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color: Colors.green[800],
                        letterSpacing: 8,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 12),
            // Cancel button (only when searching or matched)
            if (_rideStatus == 'searching' || _rideStatus == 'matched')
              OutlinedButton(
                onPressed: _cancelCurrentRide,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 50),
                  side: const BorderSide(color: Colors.red),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: Text('Cancel Ride', style: GoogleFonts.inter(color: Colors.red)),
              ),
          ],
        ),
      ),
    );
  }

  void _onSearchChanged({required bool isPickup}) {
    if (_ignoreSearchChange) return;
    final controller = isPickup ? _pickupController : _searchController;
    
    if (_debounce?.isActive ?? false) _debounce!.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (controller.text.isNotEmpty) {
        _fetchSuggestions(controller.text, isPickup: isPickup);
      } else {
        if (mounted) {
          setState(() {
            if (isPickup) _pickupSuggestions = [];
            else _suggestions = [];
          });
        }
      }
    });
  }

  Future<void> _fetchSuggestions(String input, {required bool isPickup}) async {
    final suggestions = await MapService.getPlaceSuggestions(input);
    if (mounted) {
      setState(() {
        if (isPickup) _pickupSuggestions = suggestions;
        else _suggestions = suggestions;
      });

      // Show a helpful tip on Web if simulation is working
      if (kIsWeb && suggestions.isNotEmpty && !suggestions[0]['place_id'].toString().startsWith('sim_')) {
        // Real results working
      } else if (kIsWeb && suggestions.isNotEmpty) {
        // Simulation working
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Web Demo Mode: Search is simulated for Coimbatore landmarks.'),
            duration: Duration(seconds: 3),
            backgroundColor: AppColors.primary,
          ),
        );
      }
    }
  }

  Future<void> _selectSuggestion(Map<String, dynamic> suggestion, {required bool isPickup}) async {
    final placeId = suggestion['place_id'];
    final description = suggestion['description'];
    
    if (mounted) {
      setState(() {
        _ignoreSearchChange = true;
        if (isPickup) {
          _pickupController.text = description;
          _pickupSuggestions = [];
        } else {
          _searchController.text = description;
          _suggestions = [];
        }
        _ignoreSearchChange = false;
        FocusScope.of(context).unfocus();
      });
    }

    final details = await MapService.getPlaceDetails(placeId);
    if (details != null && mounted) {
      final latLng = LatLng(details['lat']!, details['lng']!);
      debugPrint('HomeScreen: Location details for $description: ${latLng.latitude}, ${latLng.longitude}');
      
      if (latLng.latitude == 0 && latLng.longitude == 0) {
        debugPrint('HomeScreen: WARNING! Received 0,0 coordinates. This will cause map issues.');
      }

      setState(() {
        if (isPickup) {
          _pickupPosition = latLng;
          _markers.removeWhere((m) => m.markerId.value == 'pickup');
          _markers.add(
            Marker(
              markerId: const MarkerId('pickup'),
              position: latLng,
              icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue), // Vibrant live blue
              infoWindow: InfoWindow(title: 'Pickup: $description'),
            ),
          );
          // Clear polyline when origin changes
          _polylines = {};
        } else {
          _destinationPosition = latLng;
          _markers.removeWhere((m) => m.markerId.value == 'destination');
          _markers.add(
            Marker(
              markerId: const MarkerId('destination'),
              position: latLng,
              icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
              infoWindow: InfoWindow(title: 'Destination: $description'),
            ),
          );
          // Clear polyline when destination changes
          _polylines = {};
        }
      });

      _updateCamera();
    }
  }

  Future<void> _updateCamera() async {
    final controller = await _controller.future;
    
    if (_pickupPosition != null && _destinationPosition != null) {
      // Zoom to fit both
      LatLngBounds bounds;
      
      // Calculate bounds safely
      double minLat = _pickupPosition!.latitude < _destinationPosition!.latitude ? _pickupPosition!.latitude : _destinationPosition!.latitude;
      double maxLat = _pickupPosition!.latitude > _destinationPosition!.latitude ? _pickupPosition!.latitude : _destinationPosition!.latitude;
      double minLng = _pickupPosition!.longitude < _destinationPosition!.longitude ? _pickupPosition!.longitude : _destinationPosition!.longitude;
      double maxLng = _pickupPosition!.longitude > _destinationPosition!.longitude ? _pickupPosition!.longitude : _destinationPosition!.longitude;

      // Defensive check for world-wrapping or massive bounds
      if ((maxLat - minLat).abs() > 170 || (maxLng - minLng).abs() > 350) {
        debugPrint('HomeScreen: WARNING! Calculated bounds are suspiciously large. Resetting to default zoom.');
        controller.animateCamera(CameraUpdate.newLatLngZoom(_destinationPosition!, 12));
        return;
      }

      bounds = LatLngBounds(
        southwest: LatLng(minLat, minLng),
        northeast: LatLng(maxLat, maxLng),
      );
      
      // Add padding for longitude logic if they wrap (simple version for now)
      controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 120));
    } else if (_pickupPosition != null) {
      controller.animateCamera(CameraUpdate.newLatLngZoom(_pickupPosition!, 15));
    } else if (_destinationPosition != null) {
      controller.animateCamera(CameraUpdate.newLatLngZoom(_destinationPosition!, 15));
    }
  }

  Future<void> _handleFindRide() async {
    if (_pickupPosition == null || _destinationPosition == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select both pickup and destination locations.')),
      );
      return;
    }

    setState(() => _isLoading = true);
    setState(() => _estimateData = null); // Clear previous estimate

    try {
      // 1. Try Backend Estimation FIRST (More features: Price, CO2, Accurate Route)
      final estimate = await MapService.getRideEstimate(_pickupPosition!, _destinationPosition!);

      if (estimate != null && mounted) {
        debugPrint('HomeScreen: Backend estimate received!');
        
        final encodedPolyline = estimate['polyline'];
        final List<LatLng> points = MapService.decodePolyline(encodedPolyline);

        setState(() {
          _estimateData = estimate;
          _polylines = {
            Polyline(
              polylineId: const PolylineId('route'),
              points: points,
              color: AppColors.primary,
              width: 5,
              jointType: JointType.round,
              startCap: Cap.roundCap,
              endCap: Cap.roundCap,
            ),
          };
          _isLoading = false;
        });

        _updateCamera();
        // Auto-request ride after getting estimate
        await _handleRequestRide();
        return;
      }
      
      // 2. Fallback to Google Directions API Direct (Visual only, no price)
      debugPrint('HomeScreen: Backend estimate failed. Falling back to direct directions...');
      final result = await MapService.getDirections(_pickupPosition!, _destinationPosition!);
      
      if (mounted && result != null) {
        final points = result['points'] as List<LatLng>;
        debugPrint('HomeScreen: Displaying route with ${points.length} points');
        
        // If the decoder stopped too early (e.g. less than 10 points for a real trip), 
        // we show a warning but still display what we have + a dash for origin/dest if needed.
        if (points.length < 5) {
           debugPrint('HomeScreen: WARNING! Polyline too short. Possible corruption.');
        }

        setState(() {
          _polylines = {
            Polyline(
              polylineId: const PolylineId('route'),
              points: points,
              color: const Color(0xFF007AFF),
              width: 6,
              jointType: JointType.round,
              startCap: Cap.roundCap,
              endCap: Cap.roundCap,
            ),
          };
          _isLoading = false;
        });

        ScaffoldMessenger.of(context).hideCurrentSnackBar();

        // Parse distance/duration from Google Directions text (e.g., "26.7 km", "58 mins")
        final distanceText = result['distance'] as String? ?? '0 km';
        final durationText = result['duration'] as String? ?? '0 mins';
        final distanceKm = double.tryParse(distanceText.replaceAll(RegExp(r'[^0-9.]'), '')) ?? 5.0;
        final durationMin = double.tryParse(durationText.replaceAll(RegExp(r'[^0-9.]'), '')) ?? 10.0;

        // Calculate fare same as backend: BASE_FARE(40) + PER_KM(12) + PER_MIN(1.5)
        final fare = (40 + distanceKm * 12 + durationMin * 1.5).round();
        final co2Saved = (distanceKm * 192).round(); // 192g/km petrol savings with EV

        setState(() {
          _estimateData = {
            'fare': fare,
            'distance_km': distanceKm.toStringAsFixed(1),
            'eta_min': durationMin.round(),
            'co2_saved_g': co2Saved,
            'polyline': '',
          };
        });

        _updateCamera();
        // Auto-request ride
        await _handleRequestRide();
      } else if (mounted) {
        setState(() {
          _isLoading = false;
          _polylines = {
            Polyline(
              polylineId: const PolylineId('route'),
              points: [_pickupPosition!, _destinationPosition!],
              color: Colors.grey,
              width: 3,
            ),
          };
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not find road-route. Showing straight line fallback.')),
        );
        _updateCamera();
      }
    } catch (e) {
      debugPrint('Error finding ride: $e');
      if (mounted) setState(() => _isLoading = false);
    }
  }



  Future<void> _loadUserData() async {
    try {
      final userModel = await AuthService.instance.getCurrentUserData();
      if (userModel != null && mounted) {
        setState(() {
          // Priority: 1. Full Name, 2. Email Prefix, 3. 'User'
          _userName = userModel.name ?? userModel.email.split('@')[0];
          _userEmail = userModel.email;
          _userPhoto = null; // We can add storage photo support later
        });
        debugPrint('HomeScreen: Loaded profile for $_userName');
      } else {
        // Fallback for basic info if Firestore is slow/blocked
        final user = AuthService.instance.currentUser;
        if (user != null && mounted) {
          setState(() {
            _userName = user.displayName ?? user.email?.split('@')[0] ?? 'User';
            _userEmail = user.email;
          });
        }
      }
    } catch (e) {
      debugPrint('HomeScreen: Error loading user data: $e');
    }
  }

  Future<void> _getCurrentLocation() async {
    bool serviceEnabled;
    PermissionStatus permissionGranted;

    try {
      debugPrint('HomeScreen: Checking location services...');
      serviceEnabled = await _location.serviceEnabled();
      if (!serviceEnabled) {
        serviceEnabled = await _location.requestService();
        if (!serviceEnabled) {
          debugPrint('HomeScreen: Location service disabled');
          if (mounted) setState(() => _isLoading = false);
          return;
        }
      }

      debugPrint('HomeScreen: Checking location permissions...');
      permissionGranted = await _location.hasPermission();
      if (permissionGranted == PermissionStatus.denied) {
        permissionGranted = await _location.requestPermission();
        if (permissionGranted != PermissionStatus.granted) {
          debugPrint('HomeScreen: Location permission denied');
          if (mounted) setState(() => _isLoading = false);
          // Show a subtle toast or banner instead of crashing
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Location permission denied. Please allow location in browser settings to see your current position on the map.'),
                backgroundColor: Colors.orange,
              ),
            );
          }
          return;
        }
      }

      debugPrint('HomeScreen: Fetching current location...');
      final locationData = await _location.getLocation().timeout(const Duration(seconds: 10));
      
      if (mounted) {
        setState(() {
          _currentPosition = LatLng(locationData.latitude!, locationData.longitude!);
          _isLoading = false;
        });

        if (_currentPosition != null) {
          final controller = await _controller.future;
          controller.animateCamera(CameraUpdate.newCameraPosition(
            CameraPosition(target: _currentPosition!, zoom: 15),
          ));
        }
      }
    } catch (e) {
      debugPrint('HomeScreen: !!! Geolocation Error: $e');
      if (mounted) {
        setState(() => _isLoading = false);
        // Don't show confusing technical errors to the user, just fallback
      }
    }
  }

  Future<void> _handleLogout() async {
    try {
      await AuthService.instance.signOut();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error logging out: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: AppColors.background,
      drawer: _buildDrawer(),
      body: Stack(
        children: [
          // 1. Google Map Background
          GoogleMap(
            mapType: MapType.normal,
            initialCameraPosition: _kDefaultLocation,
            myLocationEnabled: true,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
            markers: _markers,
            polylines: _polylines,
            onMapCreated: (GoogleMapController controller) {
              _controller.complete(controller);
            },
          ),

          // 2. Overlay Content (Header + Search)
          // Only the actual widgets capture touches; empty space passes through to the map
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                     _buildTopBar(),
                     // Hide route card when ride is active (matched, arrived, on_trip, searching)
                     if (!_isSearchingForDriver) ...[
                       const SizedBox(height: 12),
                       _buildRouteCard(),
                     ],
                  ],
                ),
              ),
            ),
          ),

          // 3. Bottom Panel (Draggable Sheet) or Estimate Sheet
          if (_isSearchingForDriver)
             _buildSearchingSheet(), // NEW searching UI

          if (!_isSearchingForDriver && _estimateData != null)
             _buildEstimateSheet(),
          
          if (!_isSearchingForDriver && _estimateData == null)
            DraggableScrollableSheet(
            initialChildSize: 0.25,
            minChildSize: 0.12,
            maxChildSize: 0.85,
            builder: (context, scrollController) {
              return Listener(
                onPointerSignal: (event) {
                  if (event is PointerScrollEvent) {
                    // Consume the event to prevent map zoom on web
                  }
                },
                child: Container(
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.08),
                        blurRadius: 20,
                        offset: const Offset(0, -8),
                      ),
                    ],
                  ),
                  child: SingleChildScrollView(
                    controller: scrollController,
                    physics: const BouncingScrollPhysics(),
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Center(
                          child: Container(
                            width: 36,
                            height: 4,
                            margin: const EdgeInsets.only(bottom: 20),
                            decoration: BoxDecoration(
                              color: AppColors.lightGrey,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ),
                        _buildMainActions(),
                        const SizedBox(height: 24),
                        Text(
                          'Quick Actions',
                          style: GoogleFonts.inter(
                            color: AppColors.textPrimary,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        _buildQuickActionCards(),
                        const SizedBox(height: 24),
                        Text(
                          'Your Impact 🌍',
                          style: GoogleFonts.inter(
                            color: AppColors.primary,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        _buildImpactStats(),
                        const SizedBox(height: 24),
                        Text(
                          'Nearby Drivers',
                          style: GoogleFonts.inter(
                             color: AppColors.textPrimary,
                             fontSize: 16,
                             fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        _buildNearbyDrivers(),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
      ],
    ),
  );
}

  Widget _buildTopBar() {
    return Row(
      children: [
        GestureDetector(
          onTap: () => _scaffoldKey.currentState?.openDrawer(),
          child: Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(14),
              boxShadow: AppShadows.soft,
            ),
            child: const Icon(Icons.menu_rounded, color: AppColors.textPrimary, size: 22),
          ),
        ),
        const Spacer(),
        _buildRoleSwitch(),
        const SizedBox(width: 10),
        _buildUserAvatar(),
      ],
    );
  }

  Widget _buildRoleSwitch() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(
        gradient: AppGradients.primaryButton,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppShadows.soft,
      ),
      child: Text(
        'Rider',
        style: GoogleFonts.inter(
          color: AppColors.white,
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Widget _buildUserAvatar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: AppShadows.soft,
      ),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              gradient: AppGradients.primaryButton,
              shape: BoxShape.circle,
            ),
            child: _userPhoto != null
              ? ClipOval(child: Image.network(_userPhoto!, fit: BoxFit.cover))
              : const Icon(Icons.person, size: 16, color: AppColors.white),
          ),
          const SizedBox(width: 8),
          Text(
            _userName?.split(' ')[0] ?? 'User',
            style: GoogleFonts.inter(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteCard() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppShadows.medium,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Pickup Field
          _buildSearchField(
            controller: _pickupController,
            hint: 'Pickup location',
            icon: Icons.circle,
            iconColor: AppColors.primaryLight,
            isPickup: true,
          ),

          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 52),
            child: Container(height: 1, color: AppColors.lightGrey.withValues(alpha: 0.5)),
          ),

          // Destination Field
          _buildSearchField(
            controller: _searchController,
            hint: 'Where to?',
            icon: Icons.circle,
            iconColor: AppColors.error,
            isPickup: false,
          ),

          if (_pickupSuggestions.isNotEmpty) _buildSuggestionsList(isPickup: true),
          if (_suggestions.isNotEmpty) _buildSuggestionsList(isPickup: false),
        ],
      ),
    );
  }

  Widget _buildSearchField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    required Color iconColor,
    required bool isPickup,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(icon, color: iconColor, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: controller,
              style: GoogleFonts.inter(color: Colors.black, fontSize: 14, fontWeight: FontWeight.w500),
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: GoogleFonts.inter(color: Colors.black45, fontSize: 14),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
              onTap: () {
                // Clear the other suggestions when switching fields
                setState(() {
                  if (isPickup) _suggestions = [];
                  else _pickupSuggestions = [];
                });
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSuggestionsList({required bool isPickup}) {
    final suggestions = isPickup ? _pickupSuggestions : _suggestions;
    return Column(
      children: [
        const Divider(color: Colors.grey, height: 1, thickness: 0.1),
        Container(
          constraints: const BoxConstraints(maxHeight: 250),
          child: ListView.separated(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            itemCount: suggestions.length + (isPickup ? 1 : 0),
            separatorBuilder: (context, index) => Divider(color: Colors.grey.withOpacity(0.1), height: 1),
            itemBuilder: (context, index) {
              // Show "Use Current Location" as first item for Pickup
              if (isPickup && index == 0) {
                 return ListTile(
                  leading: const Icon(Icons.my_location, color: Colors.blue, size: 20),
                  title: Text(
                    'Use Current Location',
                    style: GoogleFonts.inter(color: Colors.blue, fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                  dense: true,
                  onTap: _useCurrentLocationForPickup,
                );
              }
              
              final suggestion = isPickup ? suggestions[index - 1] : suggestions[index];
              return ListTile(
                leading: const Icon(Icons.location_on, color: Colors.grey, size: 18),
                title: Text(
                  suggestion['description'],
                  style: GoogleFonts.inter(color: Colors.black87, fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                dense: true,
                onTap: () => _selectSuggestion(suggestion, isPickup: isPickup),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8.0),
          child: Align(
            alignment: Alignment.centerRight,
            child: Text(
              'powered by Google',
              style: GoogleFonts.inter(
                color: Colors.grey.withOpacity(0.5),
                fontSize: 10,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildEstimateSheet() {
      return Align(
        alignment: Alignment.bottomCenter,
        child: Listener(
          onPointerSignal: (event) {
            if (event is PointerScrollEvent) {
               // Consume scroll event
            }
          },
          child: Container(
            margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(28),
            boxShadow: AppShadows.medium,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Handle Drag Indicator
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.lightGrey,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 20),

              // Title
              Text(
                'Ride Estimate',
                style: GoogleFonts.inter(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 20),

              // Fare Row
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                   Row(
                     children: [
                       Container(
                         padding: const EdgeInsets.all(12),
                         decoration: BoxDecoration(
                           gradient: AppGradients.mintFade,
                           borderRadius: BorderRadius.circular(14),
                         ),
                         child: const Icon(Icons.currency_rupee, color: AppColors.primary, size: 22),
                       ),
                       const SizedBox(width: 12),
                       Column(
                         crossAxisAlignment: CrossAxisAlignment.start,
                         children: [
                           Text(
                             'Estimated Fare',
                             style: GoogleFonts.inter(
                               color: AppColors.textSecondary,
                               fontSize: 12,
                               fontWeight: FontWeight.w500,
                             ),
                           ),
                           Text(
                             '₹${_estimateData!['fare']}',
                             style: GoogleFonts.inter(
                               color: AppColors.textPrimary,
                               fontSize: 26,
                               fontWeight: FontWeight.w800,
                             ),
                           ),
                         ],
                       ),
                     ],
                   ),
                   
                   // ETA Pill
                   Container(
                     padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                     decoration: BoxDecoration(
                       color: AppColors.offWhite,
                       borderRadius: BorderRadius.circular(20),
                       border: Border.all(color: AppColors.lightGrey.withValues(alpha: 0.5)),
                     ),
                     child: Row(
                       children: [
                         const Icon(Icons.timer_outlined, size: 16, color: AppColors.info),
                         const SizedBox(width: 6),
                         Text(
                           '${_estimateData!['eta_min']} min',
                           style: GoogleFonts.inter(
                             fontWeight: FontWeight.w700,
                             fontSize: 13,
                           ),
                         ),
                       ],
                     ),
                   ),
                ],
              ),
              
              const SizedBox(height: 16),
              
              // CO2 Saved Badge
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFECFDF5), Color(0xFFD1FAE5)],
                  ),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.eco, color: AppColors.primary, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Green Choice 🌱',
                            style: GoogleFonts.inter(
                              color: AppColors.primaryDark,
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Save ${_estimateData!['co2_saved_g']}g CO₂ with this Eco-Ride!',
                            style: GoogleFonts.inter(
                              color: AppColors.primary,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Action Buttons
              Row(
                children: [
                  Expanded(
                    child: Container(
                      height: 52,
                      decoration: BoxDecoration(
                        color: AppColors.offWhite,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppColors.lightGrey),
                      ),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () {
                            setState(() {
                              _estimateData = null;
                              _polylines = {};
                              _markers.removeWhere((m) => m.markerId.value == 'pickup' || m.markerId.value == 'destination');
                              _pickupController.clear();
                              _searchController.clear();
                              _pickupPosition = null;
                              _destinationPosition = null;
                            });
                          },
                          borderRadius: BorderRadius.circular(16),
                          child: Center(
                            child: Text('Cancel', style: GoogleFonts.inter(fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    flex: 2,
                    child: Container(
                      height: 52,
                      decoration: BoxDecoration(
                        gradient: AppGradients.primaryButton,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: AppShadows.glow,
                      ),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: _handleRequestRide,
                          borderRadius: BorderRadius.circular(16),
                          child: Center(
                            child: Text(
                              'Find Ride',
                              style: GoogleFonts.inter(fontWeight: FontWeight.w700, color: AppColors.white, fontSize: 16),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
  
  Widget _buildMainActions() {
    return Column(
      children: [
        // Find Ride
         ElevatedButton.icon(
          onPressed: _handleFindRide,
          icon: const Icon(Icons.directions_car_filled_outlined),
          label: const Text('Find a Ride'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.primary, // Green
            foregroundColor: Colors.white,
            elevation: 2,
             minimumSize: const Size.fromHeight(50),
             shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildQuickActionCards() {
    return Row(
      children: [
        Expanded(
          child: _buildActionCard(
            'Get Price Estimate',
            'Check fare & ETA',
            Icons.attach_money,
            Colors.green.shade800,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _buildActionCard(
            'Green Rewards',
            'Your eco-points',
            Icons.card_giftcard,
            Colors.teal.shade800,
          ),
        ),
      ],
    );
  }

  Widget _buildActionCard(String title, String subtitle, IconData icon, Color bgColor) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.lightGrey.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: bgColor.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: AppColors.primary, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.inter(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                Text(
                  subtitle,
                  style: GoogleFonts.inter(
                    color: AppColors.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildImpactStats() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.lightGrey.withOpacity(0.1)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _buildStatItem('0', 'Rides Taken'),
          _buildStatItem('0%', 'Trust Score'),
          _buildStatItem('0', 'Green Points'),
          _buildStatItem('₹0', 'Money Saved'),
        ],
      ),
    );
  }

  Widget _buildStatItem(String value, String label) {
    return Column(
      children: [
        Text(
          value,
          style: GoogleFonts.inter(
            color: AppColors.primary,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: GoogleFonts.inter(
            color: AppColors.textSecondary,
            fontSize: 10,
          ),
        ),
      ],
    );
  }

  Widget _buildNearbyDrivers() {
    return Container(
       padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.lightGrey.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                  Text('0', style: GoogleFonts.inter(color: AppColors.primary, fontSize: 24, fontWeight: FontWeight.bold)),
                  Text('Available', style: GoogleFonts.inter(color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Container(
               padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                   Text('0', style: GoogleFonts.inter(color: Colors.orange, fontSize: 24, fontWeight: FontWeight.bold)),
                  Text('Busy', style: GoogleFonts.inter(color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDrawer() {
    return Drawer(
      backgroundColor: AppColors.surface,
      child: Column(
        children: [
          UserAccountsDrawerHeader(
            decoration: const BoxDecoration(color: AppColors.primary),
            currentAccountPicture: CircleAvatar(
              backgroundColor: Colors.white,
              backgroundImage: _userPhoto != null ? NetworkImage(_userPhoto!) : null,
              child: _userPhoto == null ? const Icon(Icons.person, color: AppColors.primary) : null,
            ),
            accountName: Text(_userName ?? 'User', style: GoogleFonts.inter(fontWeight: FontWeight.bold)),
            accountEmail: Text(_userEmail ?? '', style: GoogleFonts.inter()),
          ),
          ListTile(
            leading: const Icon(Icons.history, color: AppColors.textPrimary),
            title: Text('Ride History', style: GoogleFonts.inter(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.payment, color: AppColors.textPrimary),
            title: Text('Payment Methods', style: GoogleFonts.inter(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.card_giftcard, color: AppColors.textPrimary),
            title: Text('Promos', style: GoogleFonts.inter(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.help_outline, color: AppColors.textPrimary),
            title: Text('Support', style: GoogleFonts.inter(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          const Spacer(),
          const Divider(color: AppColors.lightGrey),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: Text('Logout', style: GoogleFonts.inter(color: Colors.red)),
            onTap: _handleLogout,
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}
