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
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../../core/services/map_service.dart';
import '../../auth/screens/login_screen.dart';
import '../../payment/screens/payment_screen.dart';
import '../../payment/screens/rating_screen.dart';
import 'rider_profile_screen.dart';
import '../widgets/save_location_modal.dart';
import '../widgets/sos_button.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final Completer<GoogleMapController> _controller =
      Completer<GoogleMapController>();
  final Location _location = Location();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final TextEditingController _pickupController = TextEditingController();
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _pickupFocusNode = FocusNode();
  final FocusNode _destinationFocusNode = FocusNode();
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
  bool _hideBottomPanel = false;
  // State for estimates
  Map<String, dynamic>? _estimateData;
  bool _isSearchingForDriver = false;
  bool _isPooled = false; // Ride pooling toggle

  // Ride lifecycle state
  String? _rideId;
  String _rideStatus =
      'idle'; // idle, searching, matched, arrived, on_trip, completed, error
  String? _driverName;
  String? _driverPhone;
  String? _otp;
  bool _showOtp = false;
  StreamSubscription<DatabaseEvent>? _rideStatusSubscription;
  Timer? _otpPollTimer;
  final FirebaseDatabase _rtdb = FirebaseDatabase.instance;

  // Driver live tracking state
  String? _driverId;
  double _driverRating = 0;
  int _driverRatingCount = 0;
  LatLng? _driverPosition;
  double _driverHeading = 0;
  StreamSubscription<DatabaseEvent>? _driverLocationSubscription;
  LatLng? _lastDriverWrittenPosition; // For throttling marker updates
  DateTime _lastRouteFetchTime = DateTime(
    2000,
  ); // For throttling route API calls
  BitmapDescriptor? _carIcon; // Custom car icon for driver marker
  String _cameraFittedForPhase =
      ''; // Track which ride phase camera was fitted for
  bool _autoCompleteTriggered =
      false; // Prevent duplicate auto-complete triggers

  // --- Profile Drawer State ---
  int _greenPoints = 0;
  String? _phoneNumber;
  Map<String, dynamic> _savedLocations =
      {}; // {home: {name, lat, lng}, work: {...}, favourite: {...}}
  List<Map<String, dynamic>> _pastRides = [];
  bool _loadingHistory = false;
  bool _showPersonalInfo = false;
  bool _showEcoPoints = false;
  bool _showSavedPlaces = false;
  bool _showRideHistory = false;
  bool _isEditingProfile = false;
  bool _savingProfile = false;
  final TextEditingController _nameEditController = TextEditingController();
  final TextEditingController _phoneEditController = TextEditingController();
  final TextEditingController _homeAddrController = TextEditingController();
  final TextEditingController _workAddrController = TextEditingController();
  final TextEditingController _favAddrController = TextEditingController();

  // --- Impact Stats State ---
  int _ridesTaken = 0;
  double _trustScore = 0.0;
  double _totalMoneySaved = 0.0;

  // --- Nearby Drivers State ---
  int _availableDrivers = 0;
  int _busyDrivers = 0;
  StreamSubscription<DatabaseEvent>? _driverCountSubscription;

  // --- Theme State ---
  bool _isDarkMode = true;
  String? _darkMapStyle;

  // --- Map Interaction State (Web) ---
  bool _isMouseOverMap = true; // Default true for mobile; toggled on web

  @override
  void initState() {
    super.initState();
    _loadUserData();
    _getCurrentLocation();
    _checkActiveRide();
    _createCarIcon();
    _loadDarkMapStyle();
    _loadNearbyDriverCounts();
    _pickupController.addListener(() => _onSearchChanged(isPickup: true));
    _searchController.addListener(() => _onSearchChanged(isPickup: false));
    _pickupFocusNode.addListener(_handleLocationFieldFocusChange);
    _destinationFocusNode.addListener(_handleLocationFieldFocusChange);
  }

  @override
  void dispose() {
    _rideStatusSubscription?.cancel();
    _driverLocationSubscription?.cancel();
    _driverCountSubscription?.cancel();
    _otpPollTimer?.cancel();
    _debounce?.cancel();
    _pickupController.dispose();
    _searchController.dispose();
    _nameEditController.dispose();
    _phoneEditController.dispose();
    _homeAddrController.dispose();
    _workAddrController.dispose();
    _favAddrController.dispose();
    _pickupFocusNode.removeListener(_handleLocationFieldFocusChange);
    _destinationFocusNode.removeListener(_handleLocationFieldFocusChange);
    _pickupFocusNode.dispose();
    _destinationFocusNode.dispose();
    super.dispose();
  }

  void _handleLocationFieldFocusChange() {
    final hasFocus =
        _pickupFocusNode.hasFocus || _destinationFocusNode.hasFocus;
    if (mounted) {
      setState(() {
        _hideBottomPanel = hasFocus;
      });
    }
  }

  /// Check for existing active ride on app launch
  Future<void> _checkActiveRide() async {
    try {
      final result = await MapService.getActiveRide();
      if (result != null &&
          result['success'] == true &&
          result['rideId'] != null) {
        final status = result['status'] as String?;
        debugPrint(
          'HomeScreen: Found ride ${result['rideId']} with status: $status',
        );

        // Only restore truly active rides
        if (status == null ||
            status == 'COMPLETED' ||
            status == 'CANCELLED' ||
            status == 'NO_DRIVERS') {
          debugPrint(
            'HomeScreen: Ride is not active ($status), skipping restore',
          );
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
      // Dismiss keyboard first
      FocusScope.of(context).unfocus();

      setState(() {
        _pickupPosition = _currentPosition;
        _pickupController.text = "Current Location";
        _pickupSuggestions = []; // Clear suggestions
        _ignoreSearchChange = true; // Prevent search trigger

        // Remove any existing pickup marker (no blue pin — rider dot shows position)
        _markers.removeWhere((m) => m.markerId.value == 'pickup');
        // Only restore panel when no field is focused
        _hideBottomPanel =
            _pickupFocusNode.hasFocus || _destinationFocusNode.hasFocus;
      });

      // Reset flag after small delay to allow typing again if user wants to change
      Future.delayed(
        const Duration(milliseconds: 500),
        () => _ignoreSearchChange = false,
      );

      _updateCamera();
    } else {
      if (mounted) {
        setState(() {
          _pickupController.text = ""; // Clear "Getting location..."
          _ignoreSearchChange = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Unable to fetch current location quickly. Please try again or search manually.',
            ),
          ),
        );
      }
    }
  }

  Future<void> _handleRequestRide() async {
    if (_estimateData == null ||
        _pickupPosition == null ||
        _destinationPosition == null)
      return;

    setState(() {
      _isSearchingForDriver = true;
      _rideStatus = 'searching';
    });

    // Extract distance/duration from backend estimate fields
    // Backend returns: distance_km (string like "26.7"), details.duration_s (int), eta_min (int)
    double distanceKm = 0.0;
    if (_estimateData!['distance_km'] != null) {
      distanceKm =
          double.tryParse(_estimateData!['distance_km'].toString()) ?? 0.0;
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
      isPooled: _isPooled,
      co2Saved: (_estimateData!['co2_saved_g'] as num?)?.toDouble() ?? 0,
    );

    if (mounted) {
      if (result != null && result['rideId'] != null) {
        final rideId = result['rideId'] as String;
        debugPrint('HomeScreen: Ride requested! ID: $rideId');
        setState(() {
          _rideId = rideId;
          _rideStatus = 'searching';
          if (result['driverName'] != null) _driverName = result['driverName'];
          if (result['driverPhone'] != null)
            _driverPhone = result['driverPhone'];
          _driverRating = (result['driverRating'] as num?)?.toDouble() ?? 0;
          _driverRatingCount =
              (result['driverRatingCount'] as num?)?.toInt() ?? 0;
        });
        _startRideStatusListener(rideId);
      } else {
        setState(() {
          _isSearchingForDriver = false;
          _rideStatus = 'idle';
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'No drivers available right now. Please try again in a moment.',
            ),
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

        // Parse driver rating from ride data (sent by backend on match)
        _driverRating =
            (data['driverRating'] as num?)?.toDouble() ?? _driverRating;
        _driverRatingCount =
            (data['driverRatingCount'] as num?)?.toInt() ?? _driverRatingCount;

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
          _polylines.removeWhere(
            (p) => p.polylineId.value == 'driver_to_pickup',
          );
          // Reset camera fit so it auto-fits for the new phase
          _cameraFittedForPhase = '';
        } else if (status == 'COMPLETED') {
          _rideStatus = 'completed';
          // Save ride info before resetting
          final completedRideId = _rideId;
          final fare = (data['fare'] as num?)?.toDouble() ?? 100.0;
          final completedDriverId = _driverId;
          final completedDriverName = _driverName ?? 'Driver';
          _resetRideState();
          // Navigate to payment screen, then rating screen
          if (completedRideId != null) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              Navigator.of(context)
                  .push(
                    MaterialPageRoute(
                      builder: (_) =>
                          PaymentScreen(rideId: completedRideId, fare: fare),
                    ),
                  )
                  .then((paid) {
                    if (!mounted) return;
                    if (paid == true && completedDriverId != null) {
                      // Navigate to rating screen after successful payment
                      Navigator.of(context)
                          .push(
                            MaterialPageRoute(
                              builder: (_) => RatingScreen(
                                rideId: completedRideId,
                                driverId: completedDriverId,
                                driverName: completedDriverName,
                              ),
                            ),
                          )
                          .then((rated) {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    rated == true
                                        ? 'Rating submitted! Thank you 🎉'
                                        : 'Payment successful! 🎉',
                                  ),
                                  backgroundColor: Colors.green,
                                ),
                              );
                            }
                          });
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            paid == true
                                ? 'Payment successful! 🎉'
                                : 'Trip completed! 🎉',
                          ),
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
              content: Text(
                reason == 'TIMEOUT'
                    ? 'Ride cancelled (no response)'
                    : 'Ride was cancelled',
              ),
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
      if (_rideId == null ||
          (_rideStatus != 'matched' && _rideStatus != 'arrived')) {
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
          content: Text(
            result != null ? 'Ride cancelled' : 'Error cancelling ride',
          ),
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
      _driverRating = 0;
      _driverRatingCount = 0;
      _driverPosition = null;
      _driverHeading = 0;
      _lastDriverWrittenPosition = null;
      _cameraFittedForPhase = '';
      _isPooled = false;
      _autoCompleteTriggered = false;
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
    final aCalc =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_toRad(a.latitude)) *
            math.cos(_toRad(b.latitude)) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
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
        final distance = _haversineDistance(
          _lastDriverWrittenPosition!,
          newPosition,
        );
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
            icon:
                _carIcon ??
                BitmapDescriptor.defaultMarkerWithHue(
                  BitmapDescriptor.hueGreen,
                ),
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

      debugPrint(
        'HomeScreen: Driver at (${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}) heading: ${heading.toStringAsFixed(0)}°',
      );

      // Auto-complete trip detection: when driver reaches ~200m of destination during ON_TRIP
      if (_rideStatus == 'on_trip' &&
          !_autoCompleteTriggered &&
          _destinationPosition != null) {
        final distToDest = _haversineDistance(
          newPosition,
          _destinationPosition!,
        );
        if (distToDest < 200) {
          _autoCompleteTriggered = true;
          debugPrint(
            'HomeScreen: Auto-complete triggered — driver within ${distToDest.toStringAsFixed(0)}m of destination',
          );
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('📍 Arriving at destination...'),
                backgroundColor: Color(0xFF22C55E),
                duration: Duration(seconds: 2),
              ),
            );
          }
        }
      }
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
          final result = await MapService.getDirections(
            _driverPosition!,
            _pickupPosition!,
          );
          if (result != null && mounted) {
            final points = result['points'] as List<LatLng>;
            setState(() {
              _polylines.removeWhere(
                (p) => p.polylineId.value == 'driver_to_pickup',
              );
              _polylines.removeWhere(
                (p) => p.polylineId.value == 'pickup_to_destination',
              );
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
          final result = await MapService.getDirections(
            _pickupPosition!,
            _destinationPosition!,
          );
          if (result != null && mounted) {
            final points = result['points'] as List<LatLng>;
            setState(() {
              _polylines.removeWhere(
                (p) => p.polylineId.value == 'pickup_to_destination',
              );
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
          final result = await MapService.getDirections(
            _driverPosition!,
            _destinationPosition!,
          );
          if (result != null && mounted) {
            final points = result['points'] as List<LatLng>;
            setState(() {
              _polylines.removeWhere(
                (p) => p.polylineId.value == 'driver_to_pickup',
              );
              _polylines.removeWhere(
                (p) => p.polylineId.value == 'pickup_to_destination',
              );
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

      if ((_rideStatus == 'matched' || _rideStatus == 'arrived') &&
          _pickupPosition != null) {
        points.add(_pickupPosition!);
      }
      if (_rideStatus == 'on_trip' && _destinationPosition != null) {
        points.add(_destinationPosition!);
      }

      if (points.length < 2) {
        controller.animateCamera(
          CameraUpdate.newLatLngZoom(_driverPosition!, 16),
        );
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
    // ── ON TRIP ────────────────────────────────────────────────────────────
    if (_rideStatus == 'on_trip') {
      final etaMin = (_estimateData?['eta_min'] as num?)?.toInt() ?? 0;
      final distanceKm = _estimateData?['distance_km']?.toString() ?? '—';
      final etaText = etaMin >= 60
          ? '${etaMin ~/ 60} hr ${etaMin % 60} min'
          : '$etaMin min';
      final pickupText = _pickupController.text.trim().isNotEmpty
          ? _pickupController.text.trim()
          : 'Pickup point';
      final dropText = _searchController.text.trim().isNotEmpty
          ? _searchController.text.trim()
          : 'Destination';

      return Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          width: double.infinity,
          margin: const EdgeInsets.fromLTRB(12, 16, 12, 16),
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: _isDarkMode ? const Color(0xFF0F1B2D) : Colors.white,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.22),
                blurRadius: 18,
                offset: const Offset(0, -4),
              ),
            ],
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E3A5F),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.route_rounded,
                        color: Colors.lightBlueAccent,
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Trip in Progress',
                          style: GoogleFonts.inter(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: _isDarkMode
                                ? Colors.white
                                : AppColors.textPrimary,
                          ),
                        ),
                        Text(
                          'Head to destination',
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            color: _isDarkMode
                                ? Colors.white54
                                : AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                // ETA + Distance row
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: _isDarkMode
                        ? const Color(0xFF1A2B42)
                        : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'ETA',
                              style: GoogleFonts.inter(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: _isDarkMode
                                    ? Colors.white38
                                    : Colors.grey.shade500,
                                letterSpacing: 1,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              etaText,
                              style: GoogleFonts.inter(
                                fontSize: 20,
                                fontWeight: FontWeight.w800,
                                color: AppColors.primary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        width: 1,
                        height: 36,
                        color: _isDarkMode
                            ? Colors.white12
                            : Colors.grey.shade300,
                      ),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(left: 16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'DISTANCE',
                                style: GoogleFonts.inter(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: _isDarkMode
                                      ? Colors.white38
                                      : Colors.grey.shade500,
                                  letterSpacing: 1,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '$distanceKm km',
                                style: GoogleFonts.inter(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.primary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                // Pickup row (dimmed / strikethrough)
                Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: Colors.grey.shade400,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        pickupText,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          color: _isDarkMode
                              ? Colors.white38
                              : Colors.grey.shade400,
                          decoration: TextDecoration.lineThrough,
                          decorationColor: Colors.grey.shade400,
                        ),
                      ),
                    ),
                  ],
                ),
                // Dotted connector line
                Padding(
                  padding: const EdgeInsets.only(left: 4, top: 3, bottom: 3),
                  child: Column(
                    children: List.generate(
                      3,
                      (_) => Container(
                        width: 2,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 2),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade500,
                          borderRadius: BorderRadius.circular(1),
                        ),
                      ),
                    ),
                  ),
                ),
                // Drop row
                Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: const BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        dropText,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: _isDarkMode
                              ? Colors.white
                              : AppColors.textPrimary,
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

    // ── DRIVER ASSIGNED (matched / arrived) ────────────────────────────────
    if (_rideStatus == 'matched' || _rideStatus == 'arrived') {
      final isArrived = _rideStatus == 'arrived';
      final etaMin = (_estimateData?['eta_min'] as num?)?.toInt() ?? 0;
      final distanceKm = _estimateData?['distance_km']?.toString() ?? '—';
      final etaText = isArrived
          ? 'Arrived'
          : etaMin >= 60
          ? '${etaMin ~/ 60} hr ${etaMin % 60} min'
          : etaMin > 0
          ? '$etaMin min'
          : '—';
      final pickupText = _pickupController.text.trim().isNotEmpty
          ? _pickupController.text.trim()
          : 'Pickup point';
      final dropText = _searchController.text.trim().isNotEmpty
          ? _searchController.text.trim()
          : 'Destination';

      return Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          width: double.infinity,
          margin: const EdgeInsets.fromLTRB(12, 16, 12, 16),
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: _isDarkMode ? const Color(0xFF0F1B2D) : Colors.white,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.22),
                blurRadius: 18,
                offset: const Offset(0, -4),
              ),
            ],
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header row
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: isArrived
                            ? Colors.green.withOpacity(0.18)
                            : const Color(0xFF1E3A5F),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        isArrived
                            ? Icons.location_on_rounded
                            : Icons.directions_car_rounded,
                        color: isArrived
                            ? Colors.greenAccent
                            : Colors.lightBlueAccent,
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            isArrived
                                ? 'Driver Arrived! 📍'
                                : 'Ride Assigned! 🎉',
                            style: GoogleFonts.inter(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: _isDarkMode
                                  ? Colors.white
                                  : AppColors.textPrimary,
                            ),
                          ),
                          Text(
                            isArrived
                                ? '${_driverName ?? "Driver"} is waiting for you'
                                : 'Navigating to your pickup',
                            style: GoogleFonts.inter(
                              fontSize: 12,
                              color: _isDarkMode
                                  ? Colors.white54
                                  : AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                // ETA + Distance
                if (!isArrived)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: _isDarkMode
                          ? const Color(0xFF1A2B42)
                          : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'ETA',
                                style: GoogleFonts.inter(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: _isDarkMode
                                      ? Colors.white38
                                      : Colors.grey.shade500,
                                  letterSpacing: 1,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                etaText,
                                style: GoogleFonts.inter(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.primary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          width: 1,
                          height: 36,
                          color: _isDarkMode
                              ? Colors.white12
                              : Colors.grey.shade300,
                        ),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(left: 16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'DISTANCE',
                                  style: GoogleFonts.inter(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: _isDarkMode
                                        ? Colors.white38
                                        : Colors.grey.shade500,
                                    letterSpacing: 1,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '$distanceKm km',
                                  style: GoogleFonts.inter(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.primary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (!isArrived) const SizedBox(height: 10),
                // Pickup row
                Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: const BoxDecoration(
                        color: Colors.lightBlueAccent,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Pickup: $pickupText',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          color: _isDarkMode
                              ? Colors.white70
                              : AppColors.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 4, top: 3, bottom: 3),
                  child: Column(
                    children: List.generate(
                      3,
                      (_) => Container(
                        width: 2,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 2),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade500,
                          borderRadius: BorderRadius.circular(1),
                        ),
                      ),
                    ),
                  ),
                ),
                // Drop row
                Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: const BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Drop: $dropText',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: _isDarkMode
                              ? Colors.white
                              : AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                // Driver info row — name + rating + call button (NO phone number)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: _isDarkMode
                        ? const Color(0xFF1A2B42)
                        : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: const BoxDecoration(
                          gradient: AppGradients.primaryButton,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.person,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _driverName ?? 'Driver',
                              style: GoogleFonts.inter(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                                color: _isDarkMode
                                    ? Colors.white
                                    : AppColors.textPrimary,
                              ),
                            ),
                            Row(
                              children: [
                                const Icon(
                                  Icons.star_rounded,
                                  size: 14,
                                  color: Color(0xFFFBBF24),
                                ),
                                const SizedBox(width: 3),
                                Text(
                                  _driverRating > 0
                                      ? _driverRating.toStringAsFixed(1)
                                      : 'New',
                                  style: GoogleFonts.inter(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: _isDarkMode
                                        ? Colors.white70
                                        : AppColors.textSecondary,
                                  ),
                                ),
                                if (_driverRatingCount > 0) ...[
                                  const SizedBox(width: 3),
                                  Text(
                                    '($_driverRatingCount)',
                                    style: GoogleFonts.inter(
                                      fontSize: 11,
                                      color: _isDarkMode
                                          ? Colors.white38
                                          : AppColors.textSecondary,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ],
                        ),
                      ),
                      // Secure call button (Twilio masked)
                      GestureDetector(
                        onTap: (_rideId != null)
                            ? () async {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                      'Connecting call securely...',
                                    ),
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
                                final result =
                                    await MapService.initiateCallMask(
                                      _rideId!,
                                      'rider',
                                    );
                                if (mounted) {
                                  final message =
                                      result?['message'] ?? 'Call failed';
                                  final success = result?['success'] == true;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(message),
                                      backgroundColor: success
                                          ? Colors.green
                                          : Colors.red,
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
                                ? AppGradients.primaryButton
                                : null,
                            color: (_rideId != null)
                                ? null
                                : AppColors.lightGrey,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.call_rounded,
                            color: (_rideId != null)
                                ? Colors.white
                                : AppColors.grey,
                            size: 20,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                // OTP
                if (_showOtp && _otp != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      vertical: 10,
                      horizontal: 20,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.green.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.green.withOpacity(0.3)),
                    ),
                    child: Column(
                      children: [
                        Text(
                          'Share this OTP with your driver',
                          style: GoogleFonts.inter(
                            color: Colors.green[700],
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _otp!,
                          style: GoogleFonts.inter(
                            fontSize: 30,
                            fontWeight: FontWeight.bold,
                            color: Colors.green[800],
                            letterSpacing: 8,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                // Navigating to Pickup button (matched only)
                if (!isArrived) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 13,
                    ),
                    decoration: BoxDecoration(
                      color: _isDarkMode
                          ? const Color(0xFF1A2B42)
                          : const Color(0xFFE8F5E9),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.directions_car_rounded,
                          color: AppColors.primary,
                          size: 18,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Navigating to Pickup ($distanceKm km)',
                          style: GoogleFonts.inter(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                // Cancel only for matched (not arrived)
                if (!isArrived) ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _cancelCurrentRide,
                      icon: const Icon(
                        Icons.close_rounded,
                        color: Colors.redAccent,
                      ),
                      label: Text(
                        'Cancel Ride',
                        style: GoogleFonts.inter(
                          color: Colors.redAccent,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(double.infinity, 48),
                        side: const BorderSide(color: Colors.redAccent),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }

    // ── SEARCHING ──────────────────────────────────────────────────────────
    if (_rideStatus == 'searching') {
      final double sheetHeight = (MediaQuery.of(context).size.height * 0.50)
          .clamp(320.0, 460.0)
          .toDouble();

      return Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          width: double.infinity,
          height: sheetHeight,
          margin: const EdgeInsets.fromLTRB(12, 16, 12, 12),
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 14),
          decoration: BoxDecoration(
            color: _isDarkMode ? const Color(0xFF0F172A) : Colors.white,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.22),
                blurRadius: 18,
                offset: const Offset(0, -4),
              ),
            ],
          ),
          child: SafeArea(
            top: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 5,
                    margin: const EdgeInsets.only(bottom: 10),
                    decoration: BoxDecoration(
                      color: _isDarkMode ? Colors.white24 : Colors.black12,
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                color: AppColors.primary.withOpacity(0.14),
                                shape: BoxShape.circle,
                              ),
                              child: const Padding(
                                padding: EdgeInsets.all(11),
                                child: CircularProgressIndicator(
                                  strokeWidth: 3,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    AppColors.primary,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Driver Notified',
                                    style: GoogleFonts.inter(
                                      fontSize: 22,
                                      fontWeight: FontWeight.w800,
                                      color: _isDarkMode
                                          ? Colors.white
                                          : AppColors.textPrimary,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    'Waiting for driver to accept your ride request...',
                                    style: GoogleFonts.inter(
                                      fontSize: 13,
                                      color: _isDarkMode
                                          ? Colors.white70
                                          : AppColors.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: _isDarkMode
                                ? const Color(0xFF111C34)
                                : const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: _isDarkMode
                                  ? Colors.white12
                                  : AppColors.lightGrey.withOpacity(0.4),
                            ),
                          ),
                          child: Column(
                            children: [
                              _buildSearchStep(
                                'Scanning nearby drivers',
                                Icons.search_rounded,
                              ),
                              const SizedBox(height: 8),
                              _buildSearchStep(
                                'Matching with best driver',
                                Icons.groups_rounded,
                              ),
                              const SizedBox(height: 8),
                              _buildSearchStep(
                                'Calculating ETA',
                                Icons.access_time_filled_rounded,
                              ),
                              const SizedBox(height: 8),
                              _buildSearchStep(
                                'Awaiting driver response',
                                Icons.timelapse_rounded,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 9,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.eco_rounded,
                                color: AppColors.primary,
                                size: 17,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Eco tip: Carpooling reduces emissions by up to 50%.',
                                  style: GoogleFonts.inter(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: _isDarkMode
                                        ? Colors.white70
                                        : AppColors.primaryDark,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _cancelCurrentRide,
                    icon: const Icon(
                      Icons.close_rounded,
                      color: Colors.redAccent,
                    ),
                    label: Text(
                      'Cancel Ride',
                      style: GoogleFonts.inter(
                        color: Colors.redAccent,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(double.infinity, 48),
                      side: const BorderSide(color: Colors.redAccent),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

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
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      color: Colors.green,
                      strokeWidth: 3,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Contacting nearby drivers...',
                      style: GoogleFonts.inter(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              )
            else ...[
              // Title row with icon
              Row(
                children: [
                  Icon(
                    _rideStatus == 'on_trip'
                        ? Icons.directions_car
                        : Icons.check_circle,
                    color: _rideStatus == 'on_trip'
                        ? Colors.blue
                        : Colors.green,
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
                          style: GoogleFonts.inter(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          _rideStatus == 'matched'
                              ? '${_driverName ?? "Driver"} is on the way'
                              : _rideStatus == 'arrived'
                              ? '${_driverName ?? "Driver"} is waiting'
                              : _rideStatus == 'on_trip'
                              ? 'Enjoy your ride!'
                              : '',
                          style: GoogleFonts.inter(
                            color: Colors.grey[600],
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],

            // Driver Info Card
            if ((_rideStatus == 'matched' ||
                    _rideStatus == 'arrived' ||
                    _rideStatus == 'on_trip') &&
                _driverName != null) ...[
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
                      child: const Icon(
                        Icons.person,
                        color: AppColors.white,
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _driverName ?? 'Driver',
                            style: GoogleFonts.inter(
                              fontWeight: FontWeight.w700,
                              fontSize: 15,
                              color: AppColors.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 2),
                          // Driver rating display
                          Row(
                            children: [
                              const Icon(
                                Icons.star_rounded,
                                size: 16,
                                color: Color(0xFFFBBF24),
                              ),
                              const SizedBox(width: 3),
                              Text(
                                _driverRating > 0
                                    ? _driverRating.toStringAsFixed(1)
                                    : 'New',
                                style: GoogleFonts.inter(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 13,
                                  color: AppColors.textPrimary,
                                ),
                              ),
                              const SizedBox(width: 3),
                              Text(
                                '($_driverRatingCount)',
                                style: GoogleFonts.inter(
                                  fontSize: 11,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    // Call button — Twilio masked call
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
                                'rider',
                              );
                              if (mounted) {
                                final message =
                                    result?['message'] ?? 'Call failed';
                                final success = result?['success'] == true;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(message),
                                    backgroundColor: success
                                        ? Colors.green
                                        : Colors.red,
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
                              ? AppGradients.primaryButton
                              : null,
                          color: (_rideId != null) ? null : AppColors.lightGrey,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.call_rounded,
                          color: (_rideId != null)
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
            if (_showOtp &&
                _otp != null &&
                (_rideStatus == 'matched' || _rideStatus == 'arrived')) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(
                  vertical: 12,
                  horizontal: 24,
                ),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.green.withOpacity(0.3)),
                ),
                child: Column(
                  children: [
                    Text(
                      'Share this OTP with your driver',
                      style: GoogleFonts.inter(
                        color: Colors.green[700],
                        fontSize: 12,
                      ),
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
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Text(
                  'Cancel Ride',
                  style: GoogleFonts.inter(color: Colors.red),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchStep(String title, IconData icon) {
    return Row(
      children: [
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: AppColors.primary.withOpacity(0.14),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 16, color: AppColors.primary),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            title,
            style: GoogleFonts.inter(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: _isDarkMode ? Colors.white : AppColors.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  void _onSearchChanged({required bool isPickup}) {
    if (_ignoreSearchChange) return;
    final controller = isPickup ? _pickupController : _searchController;

    // Don't suggest while the text still shows the GPS placeholder
    if (isPickup && controller.text.trim() == 'Current Location') return;

    if (_debounce?.isActive ?? false) _debounce!.cancel();
    _debounce = Timer(const Duration(milliseconds: 150), () {
      if (controller.text.isNotEmpty) {
        _fetchSuggestions(controller.text, isPickup: isPickup);
      } else {
        if (mounted) {
          setState(() {
            if (isPickup)
              _pickupSuggestions = [];
            else
              _suggestions = [];
          });
        }
      }
    });
  }

  Future<void> _fetchSuggestions(String input, {required bool isPickup}) async {
    final suggestions = await MapService.getPlaceSuggestions(input);
    if (mounted) {
      setState(() {
        if (isPickup)
          _pickupSuggestions = suggestions;
        else
          _suggestions = suggestions;
      });

      // Show a helpful tip on Web if simulation is working
      if (kIsWeb &&
          suggestions.isNotEmpty &&
          !suggestions[0]['place_id'].toString().startsWith('sim_')) {
        // Real results working
      } else if (kIsWeb && suggestions.isNotEmpty) {
        // Simulation working
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Web Demo Mode: Search is simulated for Coimbatore landmarks.',
            ),
            duration: Duration(seconds: 3),
            backgroundColor: AppColors.primary,
          ),
        );
      }
    }
  }

  Future<void> _selectSuggestion(
    Map<String, dynamic> suggestion, {
    required bool isPickup,
  }) async {
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
      });
      // Unfocus OUTSIDE setState to avoid side-effect ordering issues
      FocusScope.of(context).unfocus();
    }

    final details = await MapService.getPlaceDetails(placeId);
    if (details != null && mounted) {
      final latLng = LatLng(details['lat']!, details['lng']!);
      debugPrint(
        'HomeScreen: Location details for $description: ${latLng.latitude}, ${latLng.longitude}',
      );

      if (latLng.latitude == 0 && latLng.longitude == 0) {
        debugPrint(
          'HomeScreen: WARNING! Received 0,0 coordinates. This will cause map issues.',
        );
      }

      setState(() {
        if (isPickup) {
          _pickupPosition = latLng;
          _markers.removeWhere((m) => m.markerId.value == 'pickup');
          // No blue pickup marker — rider's live dot represents their position
          // Clear polyline when origin changes
          _polylines = {};
        } else {
          _destinationPosition = latLng;
          _markers.removeWhere((m) => m.markerId.value == 'destination');
          _markers.add(
            Marker(
              markerId: const MarkerId('destination'),
              position: latLng,
              icon: BitmapDescriptor.defaultMarkerWithHue(
                BitmapDescriptor.hueRed,
              ),
              infoWindow: InfoWindow(title: 'Destination: $description'),
            ),
          );
          // Clear polyline when destination changes
          _polylines = {};
        }
        // Only restore panel if neither field is focused —
        // prevents async completion from overriding a re-tap that happened
        // while getPlaceDetails was loading
        _hideBottomPanel =
            _pickupFocusNode.hasFocus || _destinationFocusNode.hasFocus;
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
      double minLat = _pickupPosition!.latitude < _destinationPosition!.latitude
          ? _pickupPosition!.latitude
          : _destinationPosition!.latitude;
      double maxLat = _pickupPosition!.latitude > _destinationPosition!.latitude
          ? _pickupPosition!.latitude
          : _destinationPosition!.latitude;
      double minLng =
          _pickupPosition!.longitude < _destinationPosition!.longitude
          ? _pickupPosition!.longitude
          : _destinationPosition!.longitude;
      double maxLng =
          _pickupPosition!.longitude > _destinationPosition!.longitude
          ? _pickupPosition!.longitude
          : _destinationPosition!.longitude;

      // Defensive check for world-wrapping or massive bounds
      if ((maxLat - minLat).abs() > 170 || (maxLng - minLng).abs() > 350) {
        debugPrint(
          'HomeScreen: WARNING! Calculated bounds are suspiciously large. Resetting to default zoom.',
        );
        controller.animateCamera(
          CameraUpdate.newLatLngZoom(_destinationPosition!, 12),
        );
        return;
      }

      bounds = LatLngBounds(
        southwest: LatLng(minLat, minLng),
        northeast: LatLng(maxLat, maxLng),
      );

      // Add padding for longitude logic if they wrap (simple version for now)
      controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 120));
    } else if (_pickupPosition != null) {
      controller.animateCamera(
        CameraUpdate.newLatLngZoom(_pickupPosition!, 15),
      );
    } else if (_destinationPosition != null) {
      controller.animateCamera(
        CameraUpdate.newLatLngZoom(_destinationPosition!, 15),
      );
    }
  }

  Future<void> _handleFindRide() async {
    if (_pickupPosition == null || _destinationPosition == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select both pickup and destination locations.'),
        ),
      );
      return;
    }

    setState(() => _isLoading = true);
    setState(() => _estimateData = null); // Clear previous estimate

    try {
      // 1. Try Backend Estimation FIRST (More features: Price, CO2, Accurate Route)
      final estimate = await MapService.getRideEstimate(
        _pickupPosition!,
        _destinationPosition!,
        isPooled: _isPooled,
      );

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
        // Do NOT auto-request ride.
        // User confirms from the estimate sheet by tapping "Find Ride".
        return;
      }

      // 2. Fallback to Google Directions API Direct (Visual only, no price)
      debugPrint(
        'HomeScreen: Backend estimate failed. Falling back to direct directions...',
      );
      final result = await MapService.getDirections(
        _pickupPosition!,
        _destinationPosition!,
      );

      if (mounted && result != null) {
        final points = result['points'] as List<LatLng>;
        debugPrint('HomeScreen: Displaying route with ${points.length} points');

        // If the decoder stopped too early (e.g. less than 10 points for a real trip),
        // we show a warning but still display what we have + a dash for origin/dest if needed.
        if (points.length < 5) {
          debugPrint(
            'HomeScreen: WARNING! Polyline too short. Possible corruption.',
          );
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
        final distanceKm =
            double.tryParse(distanceText.replaceAll(RegExp(r'[^0-9.]'), '')) ??
            5.0;
        final durationMin =
            double.tryParse(durationText.replaceAll(RegExp(r'[^0-9.]'), '')) ??
            10.0;

        // Calculate fare same as backend: BASE_FARE(40) + PER_KM(12) + PER_MIN(1.5)
        final fare = (40 + distanceKm * 12 + durationMin * 1.5).round();
        final co2Saved = (distanceKm * 192)
            .round(); // 192g/km petrol savings with EV

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
        // Do NOT auto-request ride.
        // User confirms from the estimate sheet by tapping "Find Ride".
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
          const SnackBar(
            content: Text(
              'Could not find road-route. Showing straight line fallback.',
            ),
          ),
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
          _userName = userModel.name ?? userModel.email.split('@')[0];
          _userEmail = userModel.email;
          _greenPoints = userModel.greenPoints;
          _phoneNumber = userModel.phoneNumber ?? userModel.toString();
        });

        // Override name with displayName from raw Firestore doc if available (matches web)
        final uid = AuthService.instance.currentUser?.uid;
        if (uid != null) {
          final userDoc = await FirebaseFirestore.instance
              .collection('users')
              .doc(uid)
              .get();
          if (userDoc.exists && mounted) {
            final data = userDoc.data()!;
            final displayName = data['displayName'] as String?;
            if (displayName != null && displayName.isNotEmpty) {
              setState(() => _userName = displayName);
            }
          }
        }
        debugPrint('HomeScreen: Loaded profile for $_userName');
      } else {
        final user = AuthService.instance.currentUser;
        if (user != null && mounted) {
          setState(() {
            _userName = user.displayName ?? user.email?.split('@')[0] ?? 'User';
            _userEmail = user.email;
          });
        }
      }

      // Fetch full user doc for photoURL and saved_locations
      final uid = AuthService.instance.currentUser?.uid;
      if (uid != null) {
        final userDoc = await FirebaseFirestore.instance
            .collection('users')
            .doc(uid)
            .get();
        if (userDoc.exists && mounted) {
          final data = userDoc.data()!;
          setState(() {
            _userPhoto = data['photoURL'] as String?;
            _phoneNumber =
                (data['phoneNumber'] ?? data['phone_number']) as String?;
            _trustScore = (data['trust_score'] as num?)?.toDouble() ?? 0.0;
            _greenPoints =
                (data['green_points'] as num?)?.toInt() ?? _greenPoints;
            final savedLocs = data['saved_locations'];
            if (savedLocs is Map) {
              _savedLocations = Map<String, dynamic>.from(savedLocs);
            }
          });
        }

        // Fetch completed rides count and money saved
        final ridesSnap = await FirebaseFirestore.instance
            .collection('rides')
            .where('riderId', isEqualTo: uid)
            .get();
        if (mounted) {
          double moneySaved = 0.0;
          int completedCount = 0;
          for (final doc in ridesSnap.docs) {
            final d = doc.data();
            final status = (d['status'] as String?)?.toUpperCase() ?? '';
            if (status == 'COMPLETED') {
              completedCount++;
              final co2 = (d['co2_saved_g'] as num?)?.toDouble() ?? 0.0;
              moneySaved += co2 * 0.5; // ~₹0.5 per gram CO₂ saved
            }
          }
          setState(() {
            _ridesTaken = completedCount;
            _totalMoneySaved = moneySaved;
          });
          debugPrint(
            'HomeScreen: Found ${ridesSnap.docs.length} total rides, $completedCount COMPLETED, moneySaved=₹${moneySaved.toStringAsFixed(0)}',
          );
        }
      }
    } catch (e) {
      debugPrint('HomeScreen: Error loading user data: $e');
    }
  }

  /// Load nearby driver counts from Firestore active rides
  Future<void> _loadNearbyDriverCounts() async {
    try {
      // Query Firestore rides collection for rides with active statuses
      final activeRidesSnap = await FirebaseFirestore.instance
          .collection('rides')
          .where(
            'status',
            whereIn: ['MATCHED', 'IN_PROGRESS', 'ARRIVED', 'SEARCHING'],
          )
          .get();

      // Filter out stale rides (older than 24 hours are likely abandoned)
      final now = DateTime.now();
      int busy = 0;
      final driverIds = <String>{};
      for (final doc in activeRidesSnap.docs) {
        final data = doc.data();
        // Check if ride was created within the last 24 hours
        final createdAt = data['createdAt'] as Timestamp?;
        final timestamp = data['timestamp'] as Timestamp?;
        final rideTime = createdAt ?? timestamp;
        if (rideTime != null) {
          final rideDate = rideTime.toDate();
          if (now.difference(rideDate).inHours > 24)
            continue; // Skip stale rides
        }
        final driverId = data['driverId'] as String?;
        if (driverId != null && driverId.isNotEmpty) {
          driverIds.add(driverId);
        }
        busy++;
      }

      if (mounted) {
        setState(() {
          _busyDrivers = driverIds.length; // Count unique busy drivers
          _availableDrivers = 0;
        });
        debugPrint(
          'HomeScreen: Firestore active rides check -> total active=${activeRidesSnap.docs.length}, recent busy=$busy, unique drivers=${driverIds.length}',
        );
      }
    } catch (e) {
      debugPrint('HomeScreen: Error loading driver counts: $e');
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
      debugPrint('HomeScreen: Error setting map style: $e');
    }
  }

  /// Show Green Rewards bottom sheet
  void _showGreenRewardsSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: _isDarkMode ? const Color(0xFF1E293B) : AppColors.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        ),
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.lightGrey,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF059669), Color(0xFF10B981)],
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                children: [
                  const Icon(Icons.eco, color: Colors.white, size: 40),
                  const SizedBox(width: 16),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Your Green Points',
                        style: GoogleFonts.inter(
                          color: Colors.white70,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$_greenPoints',
                        style: GoogleFonts.inter(
                          color: Colors.white,
                          fontSize: 36,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'How to Earn Points',
              style: GoogleFonts.inter(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: _isDarkMode ? Colors.white : AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            _buildRewardRow(Icons.directions_car, 'Complete a ride', '+10 pts'),
            _buildRewardRow(Icons.people, 'Pool with others', '+15 pts'),
            _buildRewardRow(Icons.electric_car, 'Use an EV', '+20 pts'),
            _buildRewardRow(Icons.star, 'Rate your driver', '+5 pts'),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildRewardRow(IconData icon, String action, String points) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: AppColors.primary, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              action,
              style: GoogleFonts.inter(
                fontSize: 14,
                color: _isDarkMode
                    ? Colors.white.withOpacity(0.9)
                    : AppColors.textPrimary,
              ),
            ),
          ),
          Text(
            points,
            style: GoogleFonts.inter(
              fontWeight: FontWeight.w700,
              color: AppColors.primary,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _fetchRideHistory() async {
    if (_loadingHistory) return;
    setState(() => _loadingHistory = true);
    try {
      final uid = AuthService.instance.currentUser?.uid;
      if (uid == null) return;
      final snapshot = await FirebaseFirestore.instance
          .collection('rides')
          .where('riderId', isEqualTo: uid)
          .get();
      if (mounted) {
        final rides = snapshot.docs
            .where((doc) {
              final status =
                  (doc.data()['status'] as String?)?.toUpperCase() ?? '';
              return status == 'COMPLETED';
            })
            .map((doc) {
              final d = doc.data();
              return {
                'id': doc.id,
                'pickupName': d['pickupName'] ?? 'Trip',
                'dropName': d['dropName'] ?? 'Destination',
                'fare': d['fare'],
                'timestamp': d['timestamp'],
                'createdAt': d['createdAt'],
                'duration': d['duration'],
                'greenPointsAwarded': d['greenPointsAwarded'],
              };
            })
            .toList();
        rides.sort((a, b) {
          final tA =
              (a['timestamp'] as Timestamp?)?.seconds ??
              (a['createdAt'] as Timestamp?)?.seconds ??
              0;
          final tB =
              (b['timestamp'] as Timestamp?)?.seconds ??
              (b['createdAt'] as Timestamp?)?.seconds ??
              0;
          return tB.compareTo(tA);
        });
        setState(() {
          _pastRides = rides;
        });
      }
    } catch (e) {
      debugPrint('HomeScreen: Error fetching ride history: $e');
    } finally {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  Future<void> _saveProfile() async {
    final uid = AuthService.instance.currentUser?.uid;
    if (uid == null) return;
    setState(() => _savingProfile = true);
    try {
      final updates = <String, dynamic>{
        'name': _nameEditController.text.trim(),
        'displayName': _nameEditController.text.trim(),
        'phoneNumber': _phoneEditController.text.trim(),
        'phone_number': _phoneEditController.text.trim(),
      };
      // Update saved_locations names
      if (_homeAddrController.text.isNotEmpty) {
        updates['saved_locations.home.name'] = _homeAddrController.text.trim();
      }
      if (_workAddrController.text.isNotEmpty) {
        updates['saved_locations.work.name'] = _workAddrController.text.trim();
      }
      if (_favAddrController.text.isNotEmpty) {
        updates['saved_locations.favourite.name'] = _favAddrController.text
            .trim();
      }
      await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .update(updates);
      // Also update Firebase Auth displayName
      await AuthService.instance.currentUser?.updateDisplayName(
        _nameEditController.text.trim(),
      );
      if (mounted) {
        setState(() {
          _userName = _nameEditController.text.trim();
          _phoneNumber = _phoneEditController.text.trim();
          _isEditingProfile = false;
        });
        // Refresh saved locations
        _loadUserData();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Profile updated!'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      debugPrint('HomeScreen: Error saving profile: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error saving: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _savingProfile = false);
    }
  }

  Future<void> _uploadProfilePicture() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.image,
        allowMultiple: false,
        withData: true,
      );

      if (result != null && result.files.first.bytes != null) {
        final uid = AuthService.instance.currentUser?.uid;
        if (uid == null) return;

        setState(() => _savingProfile = true);

        // Upload to Firebase Storage - MATCH WEB (dash)
        final fileName = 'profile-pictures/$uid';
        final photoURL = await AuthService.instance.uploadBytes(
          result.files.first.bytes!,
          fileName,
        );

        // Update Firestore
        await FirebaseFirestore.instance.collection('users').doc(uid).update({
          'photoURL': photoURL,
          'updated_at': FieldValue.serverTimestamp(),
        });

        // Update Firebase Auth
        await AuthService.instance.currentUser?.updatePhotoURL(photoURL);

        if (mounted) {
          setState(() {
            _userPhoto = photoURL;
            _savingProfile = false;
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Profile picture updated!'),
              backgroundColor: Colors.green,
            ),
          );
        }
      }
    } catch (e) {
      debugPrint('HomeScreen: Error uploading DP: $e');
      if (mounted) {
        setState(() => _savingProfile = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error uploading: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
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
                content: Text(
                  'Location permission denied. Please allow location in browser settings to see your current position on the map.',
                ),
                backgroundColor: Colors.orange,
              ),
            );
          }
          return;
        }
      }

      debugPrint('HomeScreen: Fetching current location...');
      final locationData = await _location.getLocation().timeout(
        const Duration(seconds: 10),
      );

      if (mounted) {
        setState(() {
          _currentPosition = LatLng(
            locationData.latitude!,
            locationData.longitude!,
          );
          _isLoading = false;
          // Auto-set pickup to current location if not already set
          if (_pickupPosition == null) {
            _pickupPosition = _currentPosition;
            _pickupController.text = 'Current Location';
            _ignoreSearchChange = true;
            _markers.removeWhere((m) => m.markerId.value == 'pickup');
          }
        });
        // Reset ignore flag after state is settled
        Future.delayed(
          const Duration(milliseconds: 300),
          () => _ignoreSearchChange = false,
        );

        if (_currentPosition != null) {
          final controller = await _controller.future;
          controller.animateCamera(
            CameraUpdate.newCameraPosition(
              CameraPosition(target: _currentPosition!, zoom: 15),
            ),
          );
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
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error logging out: $e')));
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
          MouseRegion(
            onEnter: (_) {
              if (kIsWeb && !_isMouseOverMap) {
                setState(() => _isMouseOverMap = true);
              }
            },
            onExit: (_) {
              if (kIsWeb && _isMouseOverMap) {
                setState(() => _isMouseOverMap = false);
              }
            },
            child: GoogleMap(
              mapType: MapType.normal,
              initialCameraPosition: _kDefaultLocation,
              myLocationEnabled: true,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              scrollGesturesEnabled: _isMouseOverMap,
              zoomGesturesEnabled: _isMouseOverMap,
              markers: _markers,
              polylines: _polylines,
              onMapCreated: (GoogleMapController controller) {
                _controller.complete(controller);
                // Apply dark map style on startup if dark mode is active
                if (_isDarkMode && _darkMapStyle != null) {
                  controller.setMapStyle(_darkMapStyle);
                }
              },
            ),
          ),

          // 2. Overlay Content (Header + Search)
          // Only the actual widgets capture touches; empty space passes through to the map
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: MouseRegion(
              onEnter: (_) {
                if (kIsWeb && _isMouseOverMap)
                  setState(() => _isMouseOverMap = false);
              },
              onExit: (_) {
                if (kIsWeb && !_isMouseOverMap)
                  setState(() => _isMouseOverMap = true);
              },
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16.0,
                    vertical: 8.0,
                  ),
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
          ),

          // 3. Bottom Panel (Draggable Sheet) or Estimate Sheet
          if (_isSearchingForDriver) _buildSearchingSheet(), // NEW searching UI

          if (!_isSearchingForDriver && _estimateData != null)
            _buildEstimateSheet(),

          // 4. SOS Safety Button — top-right so it never overlaps the bottom card
          if (_rideStatus == 'on_trip' ||
              _rideStatus == 'matched' ||
              _rideStatus == 'arrived')
            Positioned(
              right: 16,
              top: MediaQuery.of(context).padding.top + 72,
              child: SosButton(riderName: _userName),
            ),

          if (!_isSearchingForDriver &&
              _estimateData == null &&
              !_hideBottomPanel)
            Align(
              alignment: Alignment.bottomCenter,
              child: Container(
                height: MediaQuery.of(context).size.height * 0.44,
                decoration: BoxDecoration(
                  color: _isDarkMode
                      ? const Color(0xFF0F172A)
                      : AppColors.surface,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(28),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.10),
                      blurRadius: 20,
                      offset: const Offset(0, -8),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    // Drag handle (visual only)
                    Center(
                      child: Container(
                        width: 36,
                        height: 4,
                        margin: const EdgeInsets.only(top: 12, bottom: 4),
                        decoration: BoxDecoration(
                          color: _isDarkMode
                              ? Colors.white24
                              : AppColors.lightGrey,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    Expanded(
                      child: SingleChildScrollView(
                        physics: const BouncingScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _buildMainActions(),
                            const SizedBox(height: 20),
                            Text(
                              'Quick Actions',
                              style: GoogleFonts.inter(
                                color: _isDarkMode
                                    ? Colors.white
                                    : AppColors.textPrimary,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 12),
                            _buildQuickActionCards(),
                            const SizedBox(height: 20),
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
                            const SizedBox(height: 20),
                            Text(
                              'Nearby Drivers',
                              style: GoogleFonts.inter(
                                color: _isDarkMode
                                    ? Colors.white
                                    : AppColors.textPrimary,
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
                  ],
                ),
              ),
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
              color: _isDarkMode ? const Color(0xFF1E293B) : AppColors.white,
              borderRadius: BorderRadius.circular(14),
              boxShadow: AppShadows.soft,
            ),
            child: Icon(
              Icons.menu_rounded,
              color: _isDarkMode ? Colors.white : AppColors.textPrimary,
              size: 22,
            ),
          ),
        ),
        const Spacer(),
        _buildRoleSwitch(),
        const SizedBox(width: 8),
        // Theme Toggle
        GestureDetector(
          onTap: _toggleTheme,
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: _isDarkMode ? const Color(0xFF1E293B) : AppColors.white,
              borderRadius: BorderRadius.circular(14),
              boxShadow: AppShadows.soft,
            ),
            child: Icon(
              _isDarkMode ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
              color: _isDarkMode ? Colors.amber : AppColors.textSecondary,
              size: 20,
            ),
          ),
        ),
        const SizedBox(width: 8),
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
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              gradient: AppGradients.primaryButton,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.white, width: 1.5),
            ),
            child: ClipOval(
              child: _userPhoto != null && _userPhoto!.isNotEmpty
                  ? Image.network(
                      _userPhoto!,
                      fit: BoxFit.cover,
                      width: 32,
                      height: 32,
                      errorBuilder: (context, error, stackTrace) =>
                          _buildInitialsAvatar(fontSize: 14),
                    )
                  : _buildInitialsAvatar(fontSize: 14),
            ),
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
    // Theme-aware colors
    final cardBg = _isDarkMode ? const Color(0xFF1A2332) : Colors.white;
    final borderColor = _isDarkMode
        ? AppColors.primary.withOpacity(0.3)
        : Colors.grey.withOpacity(0.2);
    final shadowColor = _isDarkMode
        ? Colors.black.withOpacity(0.25)
        : Colors.black.withOpacity(0.08);
    final dotBorderColor = _isDarkMode
        ? Colors.white.withOpacity(0.4)
        : Colors.white.withOpacity(0.9);
    final dashColor = _isDarkMode
        ? Colors.grey.withOpacity(0.4)
        : Colors.grey.withOpacity(0.35);
    final dividerColor = _isDarkMode
        ? Colors.grey.withOpacity(0.3)
        : Colors.grey.withOpacity(0.2);

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderColor, width: 1.5),
        boxShadow: [
          BoxShadow(
            color: shadowColor,
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
          if (_isDarkMode)
            BoxShadow(
              color: AppColors.primary.withOpacity(0.08),
              blurRadius: 30,
              offset: const Offset(0, 4),
            ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Pickup + Destination with connected line
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Route indicator dots + line
                Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: Column(
                    children: [
                      // Green pickup dot with glow
                      Container(
                        width: 14,
                        height: 14,
                        decoration: BoxDecoration(
                          color: const Color(0xFF4CAF50),
                          shape: BoxShape.circle,
                          border: Border.all(color: dotBorderColor, width: 1.5),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF4CAF50).withOpacity(0.5),
                              blurRadius: 8,
                              spreadRadius: 1,
                            ),
                          ],
                        ),
                      ),
                      // Dashed vertical line
                      ...List.generate(
                        3,
                        (_) => Column(
                          children: [
                            const SizedBox(height: 3),
                            Container(
                              width: 2,
                              height: 6,
                              decoration: BoxDecoration(
                                color: dashColor,
                                borderRadius: BorderRadius.circular(1),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 3),
                      // Red destination dot with glow
                      Container(
                        width: 14,
                        height: 14,
                        decoration: BoxDecoration(
                          color: const Color(0xFFEF5350),
                          shape: BoxShape.circle,
                          border: Border.all(color: dotBorderColor, width: 1.5),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFFEF5350).withOpacity(0.5),
                              blurRadius: 8,
                              spreadRadius: 1,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                // Text fields
                Expanded(
                  child: Column(
                    children: [
                      _buildSearchField(
                        controller: _pickupController,
                        hint: 'Pickup location',
                        icon: Icons.circle,
                        iconColor: const Color(0xFF4CAF50),
                        isPickup: true,
                      ),
                      Container(
                        height: 1,
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              Colors.transparent,
                              dividerColor,
                              Colors.transparent,
                            ],
                          ),
                        ),
                      ),
                      _buildSearchField(
                        controller: _searchController,
                        hint: 'Where to?',
                        icon: Icons.circle,
                        iconColor: const Color(0xFFEF5350),
                        isPickup: false,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          if (_pickupSuggestions.isNotEmpty)
            _buildSuggestionsList(isPickup: true),
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
    // Theme-aware text colors
    final textColor = _isDarkMode ? Colors.white : Colors.black87;
    final hintColor = _isDarkMode ? Colors.grey.shade400 : Colors.grey.shade500;
    final clearColor = _isDarkMode
        ? Colors.grey.shade400
        : Colors.grey.shade600;

    return TextField(
      controller: controller,
      focusNode: isPickup ? _pickupFocusNode : _destinationFocusNode,
      style: GoogleFonts.inter(
        color: textColor,
        fontSize: 15,
        fontWeight: FontWeight.w500,
      ),
      cursorColor: textColor,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: GoogleFonts.inter(
          color: hintColor,
          fontSize: 15,
          fontWeight: FontWeight.w400,
        ),
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        filled: true,
        fillColor: Colors.transparent,
        hoverColor: Colors.transparent,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
        suffixIcon: controller.text.isNotEmpty
            ? GestureDetector(
                onTap: () {
                  setState(() {
                    controller.clear();
                    if (isPickup)
                      _pickupSuggestions = [];
                    else
                      _suggestions = [];
                  });
                },
                child: Icon(Icons.close, color: clearColor, size: 18),
              )
            : null,
      ),
      onTap: () {
        // Hide bottom panel while editing
        setState(() {
          _hideBottomPanel = true;
          // Clear the other field's suggestions
          if (isPickup)
            _suggestions = [];
          else
            _pickupSuggestions = [];
        });
        // Don't auto-fetch suggestions if pickup is already set to current GPS location
        // — user needs to type to search a new pickup point
        final query = controller.text.trim();
        if (isPickup && query == 'Current Location') return;
        // Show suggestions immediately: use existing text or fallback to nearby places
        _fetchSuggestions(
          query.isNotEmpty ? query : 'Coimbatore',
          isPickup: isPickup,
        );
      },
    );
  }

  Widget _buildSuggestionsList({required bool isPickup}) {
    final suggestions = isPickup ? _pickupSuggestions : _suggestions;
    // Theme-aware colors
    final listBg = _isDarkMode ? const Color(0xFF1A2332) : Colors.white;
    final separatorColor = _isDarkMode
        ? Colors.grey.withOpacity(0.15)
        : Colors.grey.withOpacity(0.12);
    final textColor = _isDarkMode
        ? Colors.white.withOpacity(0.85)
        : Colors.black87;
    final locationLabelColor = const Color(0xFF26C6DA);

    return Column(
      children: [
        Divider(
          color: _isDarkMode
              ? Colors.grey.withOpacity(0.2)
              : Colors.grey.withOpacity(0.15),
          height: 1,
          thickness: 0.5,
        ),
        Container(
          constraints: const BoxConstraints(maxHeight: 250),
          decoration: BoxDecoration(
            color: listBg,
            borderRadius: const BorderRadius.vertical(
              bottom: Radius.circular(16),
            ),
          ),
          child: ListView.separated(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            itemCount: suggestions.length + (isPickup ? 1 : 0),
            separatorBuilder: (context, index) =>
                Divider(color: separatorColor, height: 1),
            itemBuilder: (context, index) {
              // Show "Use Current Location" as first item for Pickup
              if (isPickup && index == 0) {
                return ListTile(
                  leading: Icon(
                    Icons.my_location,
                    color: locationLabelColor,
                    size: 20,
                  ),
                  title: Text(
                    'Use Current Location',
                    style: GoogleFonts.inter(
                      color: locationLabelColor,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  dense: true,
                  onTap: _useCurrentLocationForPickup,
                );
              }

              final suggestion = isPickup
                  ? suggestions[index - 1]
                  : suggestions[index];
              return ListTile(
                leading: Icon(
                  Icons.location_on,
                  color: isPickup
                      ? const Color(0xFF4CAF50).withOpacity(0.8)
                      : const Color(0xFFEF5350).withOpacity(0.8),
                  size: 18,
                ),
                title: Text(
                  suggestion['description'],
                  style: GoogleFonts.inter(color: textColor, fontSize: 13),
                  maxLines: 2,
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
              Row(
                children: [
                  Text(
                    'Ride Estimate',
                    style: GoogleFonts.inter(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (_isPooled) ...[
                    const SizedBox(width: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF22C55E), Color(0xFF10B981)],
                        ),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'SHARED RIDE',
                        style: GoogleFonts.inter(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ],
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
                        child: const Icon(
                          Icons.currency_rupee,
                          color: AppColors.primary,
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _isPooled ? 'Pooled Fare' : 'Estimated Fare',
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
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.offWhite,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: AppColors.lightGrey.withValues(alpha: 0.5),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.timer_outlined,
                          size: 16,
                          color: AppColors.info,
                        ),
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
                      child: const Icon(
                        Icons.eco,
                        color: AppColors.primary,
                        size: 20,
                      ),
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
                              _markers.removeWhere(
                                (m) =>
                                    m.markerId.value == 'pickup' ||
                                    m.markerId.value == 'destination',
                              );
                              _pickupController.clear();
                              _searchController.clear();
                              _pickupPosition = null;
                              _destinationPosition = null;
                            });
                          },
                          borderRadius: BorderRadius.circular(16),
                          child: Center(
                            child: Text(
                              'Cancel',
                              style: GoogleFonts.inter(
                                fontWeight: FontWeight.w600,
                                color: AppColors.textSecondary,
                              ),
                            ),
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
                              _isPooled ? 'Confirm Shared Ride' : 'Find Ride',
                              style: GoogleFonts.inter(
                                fontWeight: FontWeight.w700,
                                color: AppColors.white,
                                fontSize: 16,
                              ),
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
        // Get Price Estimate
        ElevatedButton.icon(
          onPressed: _handleFindRide,
          icon: const Icon(Icons.attach_money_rounded),
          label: const Text('Get Price Estimate'),
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
    return GestureDetector(
      onTap: _showGreenRewardsSheet,
      child: _buildActionCard(
        'Green Rewards',
        '$_greenPoints pts',
        Icons.card_giftcard,
        Colors.teal.shade800,
      ),
    );
  }

  Widget _buildActionCard(
    String title,
    String subtitle,
    IconData icon,
    Color bgColor,
  ) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _isDarkMode ? const Color(0xFF1E293B) : AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: _isDarkMode
              ? Colors.white12
              : AppColors.lightGrey.withOpacity(0.1),
        ),
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
                    color: _isDarkMode ? Colors.white : AppColors.textPrimary,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                Text(
                  subtitle,
                  style: GoogleFonts.inter(
                    color: _isDarkMode
                        ? Colors.white.withValues(alpha: 0.8)
                        : AppColors.textSecondary,
                    fontSize: 11,
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
        color: _isDarkMode ? const Color(0xFF1E293B) : AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: _isDarkMode
              ? Colors.white12
              : AppColors.lightGrey.withOpacity(0.1),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _buildStatItem('$_ridesTaken', 'Rides Taken'),
          _buildStatItem(
            '${(_trustScore * 100).toStringAsFixed(0)}%',
            'Trust Score',
          ),
          _buildStatItem('$_greenPoints', 'Green Points'),
          _buildStatItem(
            '₹${_totalMoneySaved.toStringAsFixed(0)}',
            'Money Saved',
          ),
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
            color: _isDarkMode ? Colors.white70 : AppColors.textSecondary,
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
        color: _isDarkMode ? const Color(0xFF1E293B) : AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: _isDarkMode
              ? Colors.white12
              : AppColors.lightGrey.withOpacity(0.1),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(_isDarkMode ? 0.2 : 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                  Text(
                    '$_availableDrivers',
                    style: GoogleFonts.inter(
                      color: AppColors.primary,
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    'Available',
                    style: GoogleFonts.inter(
                      color: _isDarkMode
                          ? Colors.white70
                          : AppColors.textSecondary,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(_isDarkMode ? 0.2 : 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                  Text(
                    '$_busyDrivers',
                    style: GoogleFonts.inter(
                      color: Colors.orange,
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    'Busy',
                    style: GoogleFonts.inter(
                      color: _isDarkMode
                          ? Colors.white70
                          : AppColors.textSecondary,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDrawerSectionHeader({
    required IconData icon,
    required String title,
    required bool isExpanded,
    required VoidCallback onTap,
    Color iconColor = AppColors.primary,
  }) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: isExpanded
              ? AppColors.primary.withOpacity(0.06)
              : Colors.transparent,
          border: Border(
            bottom: BorderSide(color: Colors.grey.withOpacity(0.1), width: 0.5),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, color: iconColor, size: 18),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                title,
                style: GoogleFonts.inter(
                  fontWeight: FontWeight.w500,
                  fontSize: 13,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            Icon(
              isExpanded ? Icons.expand_less : Icons.expand_more,
              color: Colors.grey[400],
              size: 18,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInitialsAvatar({double fontSize = 22}) {
    String initials = '';
    if (_userName != null && _userName!.isNotEmpty) {
      final parts = _userName!.trim().split(' ');
      if (parts.length >= 2) {
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
      } else if (parts[0].isNotEmpty) {
        initials = parts[0][0].toUpperCase();
      }
    }

    return Container(
      color: Colors.white.withOpacity(0.9),
      alignment: Alignment.center,
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: GoogleFonts.inter(
          color: AppColors.primary,
          fontWeight: FontWeight.w800,
          fontSize: fontSize,
        ),
      ),
    );
  }

  Widget _buildFallbackAvatar() {
    return Container(
      color: Colors.white,
      child: const Icon(Icons.person, size: 30, color: AppColors.primary),
    );
  }

  Widget _buildInfoRow(
    IconData icon,
    String label,
    String value, {
    Color? iconColor,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Row(
        children: [
          Icon(icon, size: 16, color: iconColor ?? Colors.grey[400]),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: GoogleFonts.inter(
                  fontSize: 10,
                  color: Colors.grey[500],
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                value.isEmpty ? 'Not set' : value,
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: value.isEmpty
                      ? Colors.grey[400]
                      : AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildEditableRow(
    IconData icon,
    String label,
    TextEditingController controller, {
    Color? iconColor,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: iconColor ?? Colors.grey[500]),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    color: Colors.grey[500],
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 2),
                TextField(
                  controller: controller,
                  style: GoogleFonts.inter(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textPrimary,
                  ),
                  decoration: InputDecoration(
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(
                      vertical: 8,
                      horizontal: 0,
                    ),
                    border: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: AppColors.primary.withOpacity(0.3),
                      ),
                    ),
                    focusedBorder: const UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: AppColors.primary,
                        width: 2,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDrawer() {
    return MouseRegion(
      onEnter: (_) {
        if (kIsWeb && _isMouseOverMap) setState(() => _isMouseOverMap = false);
      },
      onExit: (_) {
        if (kIsWeb && !_isMouseOverMap) setState(() => _isMouseOverMap = true);
      },
      child: Drawer(
        backgroundColor: AppColors.surface,
        width: 300, // Fixed width for a more standard sidebar look
        child: Column(
          children: [
            // Profile Header with DP
            Container(
              width: double.infinity,
              padding: EdgeInsets.only(
                top: MediaQuery.of(context).padding.top + 12,
                bottom: 12,
              ),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF1B5E20),
                    Color(0xFF2E7D32),
                    Color(0xFF43A047),
                  ],
                ),
              ),
              child: Column(
                children: [
                  // Profile Picture with Edit Overlay
                  GestureDetector(
                    onTap: _savingProfile ? null : _uploadProfilePicture,
                    child: Stack(
                      children: [
                        Container(
                          width: 60,
                          height: 60,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.1),
                                blurRadius: 4,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: ClipOval(
                            child: _savingProfile
                                ? const Center(
                                    child: SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                  )
                                : (_userPhoto != null && _userPhoto!.isNotEmpty
                                      ? Image.network(
                                          _userPhoto!,
                                          fit: BoxFit.cover,
                                          width: 60,
                                          height: 60,
                                          errorBuilder:
                                              (context, error, stackTrace) =>
                                                  _buildInitialsAvatar(),
                                        )
                                      : (FirebaseAuth
                                                    .instance
                                                    .currentUser
                                                    ?.photoURL !=
                                                null
                                            ? Image.network(
                                                FirebaseAuth
                                                    .instance
                                                    .currentUser!
                                                    .photoURL!,
                                                fit: BoxFit.cover,
                                                width: 60,
                                                height: 60,
                                                errorBuilder:
                                                    (
                                                      context,
                                                      error,
                                                      stackTrace,
                                                    ) => _buildInitialsAvatar(),
                                              )
                                            : _buildInitialsAvatar())),
                          ),
                        ),
                        Positioned(
                          bottom: 0,
                          right: 0,
                          child: Container(
                            padding: const EdgeInsets.all(4),
                            decoration: const BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.camera_alt,
                              size: 12,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _userName ?? 'User',
                    style: GoogleFonts.inter(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    _userEmail ?? '',
                    style: GoogleFonts.inter(
                      color: Colors.white.withOpacity(0.8),
                      fontSize: 9.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 1.5,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      'RIDER',
                      style: GoogleFonts.inter(
                        color: Colors.white,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Scrollable sections
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  // --- Personal Information ---
                  _buildDrawerSectionHeader(
                    icon: Icons.person_outline,
                    title: 'Personal Information',
                    isExpanded: _showPersonalInfo,
                    onTap: () {
                      setState(() {
                        _showPersonalInfo = !_showPersonalInfo;
                        if (_showPersonalInfo && !_isEditingProfile) {
                          _nameEditController.text = _userName ?? '';
                          _phoneEditController.text = _phoneNumber ?? '';
                        }
                      });
                    },
                  ),
                  AnimatedCrossFade(
                    firstChild: const SizedBox.shrink(),
                    secondChild: Container(
                      color: AppColors.surface,
                      padding: const EdgeInsets.only(top: 8, bottom: 12),
                      child: Column(
                        children: [
                          if (_isEditingProfile) ...[
                            _buildEditableRow(
                              Icons.person,
                              'Full Name',
                              _nameEditController,
                            ),
                            _buildEditableRow(
                              Icons.phone,
                              'Phone Number',
                              _phoneEditController,
                            ),
                            _buildInfoRow(
                              Icons.email,
                              'Email Address',
                              _userEmail ?? '',
                              iconColor: Colors.grey[400],
                            ),
                            const SizedBox(height: 8),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 24,
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: () => setState(
                                        () => _isEditingProfile = false,
                                      ),
                                      style: OutlinedButton.styleFrom(
                                        side: const BorderSide(
                                          color: Colors.red,
                                        ),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            10,
                                          ),
                                        ),
                                      ),
                                      child: Text(
                                        'Cancel',
                                        style: GoogleFonts.inter(
                                          color: Colors.red,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: ElevatedButton(
                                      onPressed: _savingProfile
                                          ? null
                                          : _saveProfile,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: AppColors.primary,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            10,
                                          ),
                                        ),
                                      ),
                                      child: _savingProfile
                                          ? const SizedBox(
                                              width: 20,
                                              height: 20,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Colors.white,
                                              ),
                                            )
                                          : Text(
                                              'Save',
                                              style: GoogleFonts.inter(
                                                color: Colors.white,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ] else ...[
                            _buildInfoRow(
                              Icons.person,
                              'Full Name',
                              _userName ?? '',
                            ),
                            _buildInfoRow(
                              Icons.phone,
                              'Phone Number',
                              _phoneNumber ?? '',
                            ),
                            _buildInfoRow(
                              Icons.email,
                              'Email Address',
                              _userEmail ?? '',
                            ),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 24,
                                vertical: 8,
                              ),
                              child: SizedBox(
                                width: double.infinity,
                                child: OutlinedButton.icon(
                                  onPressed: () {
                                    setState(() {
                                      _isEditingProfile = true;
                                      _nameEditController.text =
                                          _userName ?? '';
                                      _phoneEditController.text =
                                          _phoneNumber ?? '';
                                    });
                                  },
                                  icon: const Icon(Icons.edit, size: 16),
                                  label: Text(
                                    'Edit',
                                    style: GoogleFonts.inter(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.primary,
                                    side: BorderSide(
                                      color: AppColors.primary.withOpacity(0.5),
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 10,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    crossFadeState: _showPersonalInfo
                        ? CrossFadeState.showSecond
                        : CrossFadeState.showFirst,
                    duration: const Duration(milliseconds: 250),
                  ),

                  // --- Eco Points ---
                  _buildDrawerSectionHeader(
                    icon: Icons.eco,
                    title: 'Eco Points',
                    isExpanded: _showEcoPoints,
                    iconColor: const Color(0xFF22C55E),
                    onTap: () =>
                        setState(() => _showEcoPoints = !_showEcoPoints),
                  ),
                  AnimatedCrossFade(
                    firstChild: const SizedBox.shrink(),
                    secondChild: Container(
                      margin: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF22C55E), Color(0xFF16A34A)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF22C55E).withOpacity(0.2),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.eco, color: Colors.white, size: 24),
                          const SizedBox(width: 12),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _greenPoints.toString(),
                                style: GoogleFonts.inter(
                                  color: Colors.white,
                                  fontSize: 24,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                'Green Points Earned',
                                style: GoogleFonts.inter(
                                  color: Colors.white.withOpacity(0.8),
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    crossFadeState: _showEcoPoints
                        ? CrossFadeState.showSecond
                        : CrossFadeState.showFirst,
                    duration: const Duration(milliseconds: 250),
                  ),

                  // --- Saved Places ---
                  _buildDrawerSectionHeader(
                    icon: Icons.bookmark_outline,
                    title: 'Saved Places',
                    isExpanded: _showSavedPlaces,
                    iconColor: Colors.orange,
                    onTap: () {
                      setState(() {
                        _showSavedPlaces = !_showSavedPlaces;
                        if (_showSavedPlaces) {
                          final home = _savedLocations['home'];
                          final work = _savedLocations['work'];
                          final fav = _savedLocations['favourite'];
                          _homeAddrController.text =
                              (home is Map ? home['name'] : '') ?? '';
                          _workAddrController.text =
                              (work is Map ? work['name'] : '') ?? '';
                          _favAddrController.text =
                              (fav is Map ? fav['name'] : '') ?? '';
                        }
                      });
                    },
                  ),
                  AnimatedCrossFade(
                    firstChild: const SizedBox.shrink(),
                    secondChild: Container(
                      color: AppColors.surface,
                      padding: const EdgeInsets.only(top: 8, bottom: 12),
                      child: Column(
                        children: [
                          if (_isEditingProfile) ...[
                            _buildEditableRow(
                              Icons.home,
                              'Home',
                              _homeAddrController,
                            ),
                            _buildEditableRow(
                              Icons.work,
                              'Work',
                              _workAddrController,
                            ),
                            _buildEditableRow(
                              Icons.favorite,
                              'Favourite',
                              _favAddrController,
                              iconColor: Colors.red[400],
                            ),
                          ] else ...[
                            _buildInfoRow(
                              Icons.home,
                              'Home',
                              (_savedLocations['home'] is Map
                                          ? (_savedLocations['home']
                                                as Map)['name']
                                          : null)
                                      as String? ??
                                  '',
                            ),
                            _buildInfoRow(
                              Icons.work,
                              'Work',
                              (_savedLocations['work'] is Map
                                          ? (_savedLocations['work']
                                                as Map)['name']
                                          : null)
                                      as String? ??
                                  '',
                            ),
                            _buildInfoRow(
                              Icons.favorite,
                              'Favourite',
                              (_savedLocations['favourite'] is Map
                                          ? (_savedLocations['favourite']
                                                as Map)['name']
                                          : null)
                                      as String? ??
                                  '',
                              iconColor: Colors.red[400],
                            ),
                          ],
                        ],
                      ),
                    ),
                    crossFadeState: _showSavedPlaces
                        ? CrossFadeState.showSecond
                        : CrossFadeState.showFirst,
                    duration: const Duration(milliseconds: 250),
                  ),

                  // --- Ride History ---
                  _buildDrawerSectionHeader(
                    icon: Icons.history,
                    title: 'Ride History',
                    isExpanded: _showRideHistory,
                    iconColor: Colors.blue,
                    onTap: () {
                      setState(() => _showRideHistory = !_showRideHistory);
                      if (_showRideHistory && _pastRides.isEmpty) {
                        _fetchRideHistory();
                      }
                    },
                  ),
                  AnimatedCrossFade(
                    firstChild: const SizedBox.shrink(),
                    secondChild: Container(
                      color: AppColors.surface,
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: _loadingHistory
                          ? const Padding(
                              padding: EdgeInsets.all(24),
                              child: Center(
                                child: CircularProgressIndicator(
                                  color: AppColors.primary,
                                ),
                              ),
                            )
                          : _pastRides.isEmpty
                          ? Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                children: [
                                  Icon(
                                    Icons.directions_car_outlined,
                                    size: 40,
                                    color: Colors.grey[300],
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    'No rides yet.\nYour green journey starts here!',
                                    textAlign: TextAlign.center,
                                    style: GoogleFonts.inter(
                                      color: Colors.grey[400],
                                      fontSize: 13,
                                    ),
                                  ),
                                ],
                              ),
                            )
                          : Column(
                              children: _pastRides.map((ride) {
                                final ts = ride['timestamp'] as Timestamp?;
                                final ca = ride['createdAt'] as Timestamp?;
                                final dateStr = ts != null
                                    ? '${ts.toDate().day}/${ts.toDate().month}/${ts.toDate().year}'
                                    : ca != null
                                    ? '${ca.toDate().day}/${ca.toDate().month}/${ca.toDate().year}'
                                    : 'Recently';

                                final fare = ride['fare'];
                                final dur = ride['duration'];
                                String durationStr = '--';
                                if (dur is num) {
                                  if (dur > 3600) {
                                    durationStr =
                                        '${(dur / 3600).floor()}h ${((dur % 3600) / 60).floor()}m';
                                  } else {
                                    durationStr = '${(dur / 60).floor()}m';
                                  }
                                } else if (dur is String) {
                                  durationStr = dur;
                                }

                                return Container(
                                  margin: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 6,
                                  ),
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(
                                      color: Colors.grey.withOpacity(0.1),
                                    ),
                                    boxShadow: [
                                      BoxShadow(
                                        color: Colors.black.withOpacity(0.04),
                                        blurRadius: 8,
                                        offset: const Offset(0, 2),
                                      ),
                                    ],
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      // Date + Completed badge
                                      Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.spaceBetween,
                                        children: [
                                          Row(
                                            children: [
                                              Icon(
                                                Icons.calendar_today,
                                                size: 12,
                                                color: Colors.grey[400],
                                              ),
                                              const SizedBox(width: 6),
                                              Text(
                                                dateStr,
                                                style: GoogleFonts.inter(
                                                  fontSize: 11,
                                                  color: Colors.grey[500],
                                                ),
                                              ),
                                            ],
                                          ),
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 8,
                                              vertical: 3,
                                            ),
                                            decoration: BoxDecoration(
                                              color: const Color(
                                                0xFF22C55E,
                                              ).withOpacity(0.1),
                                              borderRadius:
                                                  BorderRadius.circular(6),
                                            ),
                                            child: Text(
                                              'COMPLETED',
                                              style: GoogleFonts.inter(
                                                fontSize: 9,
                                                fontWeight: FontWeight.w700,
                                                color: const Color(0xFF22C55E),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 10),
                                      // Pickup → Drop
                                      Row(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Column(
                                            children: [
                                              Container(
                                                width: 8,
                                                height: 8,
                                                decoration: const BoxDecoration(
                                                  color: Color(0xFF22C55E),
                                                  shape: BoxShape.circle,
                                                ),
                                              ),
                                              Container(
                                                width: 1,
                                                height: 20,
                                                color: Colors.grey[300],
                                              ),
                                              Icon(
                                                Icons.location_on,
                                                size: 14,
                                                color: Colors.red[400],
                                              ),
                                            ],
                                          ),
                                          const SizedBox(width: 10),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  ride['pickupName'] ?? 'Trip',
                                                  style: GoogleFonts.inter(
                                                    fontSize: 13,
                                                    fontWeight: FontWeight.w500,
                                                    color:
                                                        AppColors.textPrimary,
                                                  ),
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                const SizedBox(height: 14),
                                                Text(
                                                  ride['dropName'] ??
                                                      'Destination',
                                                  style: GoogleFonts.inter(
                                                    fontSize: 13,
                                                    fontWeight: FontWeight.w500,
                                                    color:
                                                        AppColors.textPrimary,
                                                  ),
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 10),
                                      Divider(
                                        color: Colors.grey[200],
                                        height: 1,
                                      ),
                                      const SizedBox(height: 8),
                                      // Duration + Points + Fare
                                      Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.spaceBetween,
                                        children: [
                                          Row(
                                            children: [
                                              Icon(
                                                Icons.timer,
                                                size: 14,
                                                color: Colors.grey[400],
                                              ),
                                              const SizedBox(width: 4),
                                              Text(
                                                durationStr,
                                                style: GoogleFonts.inter(
                                                  fontSize: 12,
                                                  color: Colors.grey[600],
                                                ),
                                              ),
                                              const SizedBox(width: 12),
                                              const Icon(
                                                Icons.eco,
                                                size: 14,
                                                color: Color(0xFF22C55E),
                                              ),
                                              const SizedBox(width: 4),
                                              Text(
                                                '+${ride['greenPointsAwarded'] ?? 10} pts',
                                                style: GoogleFonts.inter(
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w600,
                                                  color: const Color(
                                                    0xFF22C55E,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                          Text(
                                            '₹${fare ?? 0}',
                                            style: GoogleFonts.inter(
                                              fontSize: 15,
                                              fontWeight: FontWeight.w700,
                                              color: AppColors.textPrimary,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                );
                              }).toList(),
                            ),
                    ),
                    crossFadeState: _showRideHistory
                        ? CrossFadeState.showSecond
                        : CrossFadeState.showFirst,
                    duration: const Duration(milliseconds: 250),
                  ),
                ],
              ),
            ),

            // View Full Profile
            Container(
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: Colors.grey.withOpacity(0.15)),
                ),
              ),
              child: ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF22C55E).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.person_rounded,
                    color: Color(0xFF22C55E),
                    size: 20,
                  ),
                ),
                title: Text(
                  'View Full Profile',
                  style: GoogleFonts.inter(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(
                  'Green points, ride history & more',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    color: Colors.grey[500],
                  ),
                ),
                trailing: const Icon(
                  Icons.arrow_forward_ios_rounded,
                  size: 14,
                  color: Colors.grey,
                ),
                onTap: () {
                  Navigator.of(context).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const RiderProfileScreen(),
                    ),
                  );
                },
              ),
            ),

            // Logout button at bottom
            Container(
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: Colors.grey.withOpacity(0.15)),
                ),
              ),
              child: ListTile(
                leading: const Icon(Icons.logout, color: Colors.red, size: 22),
                title: Text(
                  'Logout',
                  style: GoogleFonts.inter(
                    color: Colors.red,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                onTap: _handleLogout,
              ),
            ),
            SizedBox(height: MediaQuery.of(context).padding.bottom + 8),
          ],
        ),
      ),
    );
  }
}
