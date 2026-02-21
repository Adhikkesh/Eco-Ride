import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:location/location.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../../core/services/map_service.dart';
import '../../auth/screens/login_screen.dart';

class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  final Completer<GoogleMapController> _controller = Completer<GoogleMapController>();
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
  
  // Ride lifecycle state
  String _rideStatus = 'idle'; // idle, pending, matched, arrived, in_progress, completed
  String? _rideId;
  String? _riderName;
  String? _riderPhone;
  bool _isAccepting = false;
  bool _isDeclining = false;
  final TextEditingController _otpController = TextEditingController();

  String? _userName;
  String? _userPhoto;

  @override
  void initState() {
    super.initState();
    _loadUserData();
    _checkInitialLocation();
  }

  @override
  void dispose() {
    _locationSubscription?.cancel();
    _pendingRideSubscription?.cancel();
    _rideSubscription?.cancel();
    _otpTimer?.cancel();
    _otpController.dispose();
    if (_isOnline) {
      _goOffline();
    }
    super.dispose();
  }

  Future<void> _loadUserData() async {
    final user = AuthService.instance.currentUser;
    if (user != null) {
      setState(() {
        _userName = user.displayName ?? 'Driver';
        _userPhoto = user.photoURL;
      });
    }
  }

  Future<void> _checkInitialLocation() async {
    try {
      final locationData = await _location.getLocation();
      setState(() {
        _currentPosition = LatLng(locationData.latitude!, locationData.longitude!);
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
              const SnackBar(content: Text('Location permission required to go online.')),
            );
          }
          return;
        }
      }

      // Initial location check before starting stream
      final initialLocation = await _location.getLocation().timeout(const Duration(seconds: 20));
      setState(() {
        _currentPosition = LatLng(initialLocation.latitude!, initialLocation.longitude!);
        _isOnline = true;
      });

      debugPrint('DriverHome: Starting location stream...');
      _locationSubscription = _location.onLocationChanged.listen((LocationData locationData) {
        if (locationData.latitude == null || locationData.longitude == null) return;

        final newPos = LatLng(locationData.latitude!, locationData.longitude!);
        final heading = locationData.heading ?? 0.0;

        if (mounted) {
          setState(() {
            _currentPosition = newPos;
            _currentHeading = heading;
          });
        }

        _updateFirebaseLocation(newPos, heading);
        _updateCamera(newPos);
      });

      // Listen for PENDING ride requests (driver must accept/decline)
      final userId = _auth.currentUser?.uid;
      if (userId != null) {
        debugPrint('DriverHome: Listening for pending rides at rides-pending/$userId');
        _pendingRideSubscription = _rtdb.ref('rides-pending/$userId').onValue.listen((event) {
          final data = event.snapshot.value as Map<dynamic, dynamic>?;
          if (data != null && data['status'] == 'PENDING_ACCEPTANCE') {
            debugPrint('DriverHome: PENDING RIDE RECEIVED! $data');
            if (mounted) {
              setState(() {
                _pendingRide = data;
                _rideId = data['rideId'] as String?;
                _rideStatus = 'pending';
                _riderName = data['riderName'] as String? ?? 'Rider';
                _riderPhone = data['riderPhone'] as String? ?? '';
              });
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
        debugPrint('DriverHome: Listening for assigned rides at rides-assigned/$userId');
        _rideSubscription = _rtdb.ref('rides-assigned/$userId').onValue.listen((event) {
          final data = event.snapshot.value as Map<dynamic, dynamic>?;
          if (data != null) {
            debugPrint('DriverHome: RIDE ASSIGNED! $data');
            if (mounted) {
              setState(() {
                _currentRide = data;
                _rideId = data['rideId'] as String? ?? _rideId;
                _rideStatus = (data['status'] as String? ?? 'MATCHED').toLowerCase();
                _riderName = data['riderName'] as String? ?? _riderName ?? 'Rider';
                _riderPhone = data['riderPhone'] as String? ?? _riderPhone ?? '';
              });
              // Auto-navigate to pickup on first assignment
              if (!_isNavigating) {
                _navigateToRide();
              }
            }
          } else {
            // Ride removed/cancelled
            if (_currentRide != null && mounted) {
              debugPrint('DriverHome: Ride assignment removed.');
              _resetRideState();
            }
          }
        });
      }
    } catch (e) {
      debugPrint('DriverHome: !!! Geolocation Error going online: $e');
      if (mounted) {
        setState(() => _isOnline = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error going online: ${e.toString().contains('denied') ? 'Location permission denied' : 'Could not fetch location'}')),
        );
      }
    }
  }

  Timer? _otpTimer;
  int _otpTimeRemaining = 300; // 5 minutes in seconds

  // ... (keep existing methods)

  // ... (keep existing methods)

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
        debugPrint('DriverHome: success=${result['success']}, message=${result['message']}');
      }
      
      if (result != null && result['success'] == true) {
        debugPrint('DriverHome: Ride accepted successfully!');
        if (mounted) {
          setState(() {
            _pendingRide = null;
            _rideStatus = 'matched';
            _isAccepting = false;
          });
          // rides-assigned listener will pick up the ride and trigger navigation
        }
      } else {
        final message = result?['message'] ?? 'Ride is no longer available';
        debugPrint('DriverHome: Accept failed: $message');
        // Ride no longer valid (cancelled, expired, etc.) — clear stale data
        if (mounted) {
          _clearPendingRide();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(message),
              backgroundColor: Colors.orange,
            ),
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
            const SnackBar(content: Text('Ride was already cancelled. Cleared.')),
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

      final newPolylines = <Polyline>{};
      final newMarkers = <Marker>{};
      List<LatLng> allPoints = [];

      // Blue polyline: Driver → Pickup
      if (toPickup != null) {
        final points = toPickup['points'] as List<LatLng>;
        newPolylines.add(Polyline(
          polylineId: const PolylineId('to_pickup'),
          points: points,
          color: Colors.blue,
          width: 5,
        ));
        allPoints.addAll(points);
      }

      // Green polyline: Pickup → Destination
      if (toDrop != null) {
        final points = toDrop['points'] as List<LatLng>;
        newPolylines.add(Polyline(
          polylineId: const PolylineId('to_destination'),
          points: points,
          color: Colors.green,
          width: 5,
        ));
        allPoints.addAll(points);
      }

      // Add markers for pickup and destination
      newMarkers.add(Marker(
        markerId: const MarkerId('pickup'),
        position: pickupLatLng,
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
        infoWindow: InfoWindow(
          title: 'Pickup',
          snippet: _currentRide!['pickupName'] as String? ?? 'Pickup Location',
        ),
      ));
      newMarkers.add(Marker(
        markerId: const MarkerId('destination'),
        position: dropLatLng,
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        infoWindow: InfoWindow(
          title: 'Destination',
          snippet: _currentRide!['dropName'] as String? ?? 'Drop Location',
        ),
      ));

      setState(() {
        _polylines = newPolylines;
        _markers = newMarkers;
      });

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
              SnackBar(content: Text(result?['message'] ?? 'Failed to cancel ride')),
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
    
    setState(() => _isLoading = true);

    try {
      // Notify backend (best-effort — timer starts regardless)
      final result = await MapService.arriveAtPickup(_rideId!);
      if (result != null && result['success'] == true) {
        debugPrint('DriverHome: Backend notified of arrival');
      } else {
        debugPrint('DriverHome: Backend arrive call failed: ${result?['message']}');
      }
    } catch (e) {
      debugPrint('DriverHome: Error notifying arrival: $e');
    }

    // Always transition to arrived state and start timer
    if (mounted) {
      setState(() {
        _rideStatus = 'arrived';
        _isLoading = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Arrived! Waiting for rider (5 min timer started)'),
          backgroundColor: Colors.green,
        ),
      );
      _startOtpTimer();
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
        const SnackBar(content: Text('Rider did not show up in 5 mins. Ride cancelled.')),
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trip started! 🚗'),
          backgroundColor: Colors.green,
        ),
      );
    } else {
      final message = result?['message'] ?? 'Failed to start ride. Check OTP.';
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      }
    }
  }

  /// Complete the ride via backend
  Future<void> _handleCompleteRide() async {
    if (_rideId == null) return;

    final result = await MapService.completeRide(_rideId!);
    if (result != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trip completed! 🎉'),
          backgroundColor: Colors.green,
        ),
      );
      _resetRideState();
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Error completing ride')),
      );
    }
  }

  /// Reset all ride state
  void _resetRideState() {
    setState(() {
      _currentRide = null;
      _pendingRide = null;
      _isNavigating = false;
      _rideStatus = 'idle';
      _rideId = null;
      _riderName = null;
      _riderPhone = null;
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

  void _updateFirebaseLocation(LatLng pos, double heading) async {
    final userId = _auth.currentUser?.uid;
    if (userId == null) return;

    // Simplified location data for now, consistent with web app structure
    await _rtdb.ref('drivers-online/$userId').set({
      'lat': pos.latitude,
      'lng': pos.longitude,
      'heading': heading,
      'status': 'AVAILABLE',
      'lastUpdated': ServerValue.timestamp,
      'vehicleType': 'CAR',
      // Note: geohash omitted for simplicity, can be added if a library is used
    });
  }

  Future<void> _updateCamera(LatLng pos) async {
    final controller = await _controller.future;
    controller.animateCamera(CameraUpdate.newCameraPosition(
      CameraPosition(target: pos, zoom: 16),
    ));
  }

  Future<void> _handleLogout() async {
    if (_isOnline) await _goOffline();
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
      backgroundColor: AppColors.background,
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
          
          // 3. Incoming/Active Ride Sheet
          if (_pendingRide != null || _currentRide != null) 
             Align(alignment: Alignment.bottomCenter, child: _buildIncomingRideSheet()),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        // Driver Info
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.surface.withOpacity(0.95),
            borderRadius: BorderRadius.circular(30),
            boxShadow: [
              BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 10),
            ],
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 16,
                backgroundColor: AppColors.primary,
                backgroundImage: _userPhoto != null ? NetworkImage(_userPhoto!) : null,
                child: _userPhoto == null 
                    ? const Icon(Icons.person, size: 20, color: Colors.white)
                    : null,
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _userName ?? 'Driver',
                    style: GoogleFonts.poppins(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                  Text(
                    'Elite Driver',
                    style: GoogleFonts.poppins(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w500,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        // Logout
        GestureDetector(
          onTap: _handleLogout,
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.red.withOpacity(0.15),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.red.withOpacity(0.3)),
            ),
            child: const Icon(Icons.logout, color: Colors.red, size: 20),
          ),
        ),
      ],
    );
  }

  Widget _buildStatusCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface.withOpacity(0.95),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 15, offset: const Offset(0, 5)),
        ],
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
                    style: GoogleFonts.poppins(
                      color: AppColors.textPrimary,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    _isOnline ? 'Accepting rides now' : 'Go online to start earning',
                    style: GoogleFonts.poppins(
                      color: AppColors.textSecondary,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
              Switch(
                value: _isOnline,
                onChanged: (_) => _toggleOnlineStatus(),
                activeColor: AppColors.primary,
                activeTrackColor: AppColors.primary.withOpacity(0.3),
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
         Expanded(child: _buildStatItem('₹0.00', 'Today\'s Earnings', Icons.account_balance_wallet_outlined, Colors.green)),
         const SizedBox(width: 12),
         Expanded(child: _buildStatItem('0', 'Today\'s Rides', Icons.directions_car_outlined, Colors.blue)),
       ],
     );
  }

  Widget _buildStatItem(String value, String label, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface.withOpacity(0.95),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.1), blurRadius: 10),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 12),
          Text(
            value,
            style: GoogleFonts.poppins(
              color: AppColors.textPrimary,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          Text(
            label,
            style: GoogleFonts.poppins(
              color: AppColors.textSecondary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildIncomingRideSheet() {
    final ride = _currentRide ?? _pendingRide;
    if (ride == null) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.15), blurRadius: 30, offset: const Offset(0, -8)),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40, height: 4,
            decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2)),
          ),
          // Status header
          _buildStatusHeader(),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_riderName != null) _buildRiderCard(),
                const SizedBox(height: 16),
                _buildRouteDetails(ride),
                if (ride['fare'] != null) ...[
                  const SizedBox(height: 16),
                  _buildFareCard(ride),
                ],
                const SizedBox(height: 20),
                if (_rideStatus == 'arrived') _buildTimerSection(),
                _buildActionButtons(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusHeader() {
    IconData icon;
    String title;
    String subtitle;
    List<Color> gradientColors;

    switch (_rideStatus) {
      case 'pending':
        icon = Icons.notifications_active_rounded;
        title = 'New Ride Request!';
        subtitle = 'A rider is waiting for you';
        gradientColors = [const Color(0xFFFF9800), const Color(0xFFF57C00)];
        break;
      case 'matched':
        icon = Icons.navigation_rounded;
        title = 'Navigating to Pickup';
        subtitle = 'Head to the pickup location';
        gradientColors = [const Color(0xFF2E7D32), const Color(0xFF4CAF50)];
        break;
      case 'arrived':
        icon = Icons.location_on_rounded;
        title = 'Waiting for Rider';
        subtitle = 'Enter OTP to start the trip';
        gradientColors = [const Color(0xFF1565C0), const Color(0xFF42A5F5)];
        break;
      case 'in_progress':
        icon = Icons.directions_car_rounded;
        title = 'Trip In Progress';
        subtitle = 'Drive safely to the destination';
        gradientColors = [const Color(0xFF6A1B9A), const Color(0xFFAB47BC)];
        break;
      default:
        icon = Icons.info_outline;
        title = 'Ride Info';
        subtitle = '';
        gradientColors = [Colors.grey[700]!, Colors.grey[500]!];
    }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: gradientColors, begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: gradientColors[0].withValues(alpha: 0.3), blurRadius: 12, offset: const Offset(0, 4)),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: Colors.white, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: GoogleFonts.poppins(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                if (subtitle.isNotEmpty)
                  Text(subtitle, style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.85), fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRiderCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.grey[50],
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.grey[200]!),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(2),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [Color(0xFF2E7D32), Color(0xFF66BB6A)]),
              borderRadius: BorderRadius.circular(22),
            ),
            child: const CircleAvatar(
              backgroundColor: Colors.white,
              radius: 20,
              child: Icon(Icons.person_rounded, color: Color(0xFF2E7D32), size: 22),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_riderName ?? 'Rider', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 15)),
                if (_riderPhone != null && _riderPhone!.isNotEmpty)
                  Row(
                    children: [
                      Icon(Icons.phone_rounded, color: Colors.grey[500], size: 14),
                      const SizedBox(width: 4),
                      Text(_riderPhone!, style: GoogleFonts.poppins(color: Colors.grey[600], fontSize: 12)),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteDetails(Map<dynamic, dynamic> ride) {
    final pickupName = ride['pickupName'] as String? ?? 'Pickup Location';
    final dropName = ride['dropName'] as String? ?? 'Drop Location';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.grey[50],
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.grey[200]!),
      ),
      child: Row(
        children: [
          Column(
            children: [
              Container(
                width: 12, height: 12,
                decoration: BoxDecoration(
                  color: const Color(0xFF4CAF50),
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                  boxShadow: [BoxShadow(color: const Color(0xFF4CAF50).withValues(alpha: 0.3), blurRadius: 4)],
                ),
              ),
              Container(width: 2, height: 30, color: Colors.grey[300]),
              Container(
                width: 12, height: 12,
                decoration: BoxDecoration(
                  color: const Color(0xFFE53935),
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                  boxShadow: [BoxShadow(color: const Color(0xFFE53935).withValues(alpha: 0.3), blurRadius: 4)],
                ),
              ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(pickupName, style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w500), maxLines: 1, overflow: TextOverflow.ellipsis),
                Container(margin: const EdgeInsets.symmetric(vertical: 8), height: 1, color: Colors.grey[200]),
                Text(dropName, style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w500), maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFareCard(Map<dynamic, dynamic> ride) {
    final fare = ride['fare'];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFFFFF8E1), Color(0xFFFFF3E0)]),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFFE082)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              const Icon(Icons.currency_rupee_rounded, color: Color(0xFFF57C00), size: 20),
              const SizedBox(width: 6),
              Text('Estimated Fare', style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFFF57C00), fontWeight: FontWeight.w500)),
            ],
          ),
          Text('\u20B9$fare', style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.bold, color: const Color(0xFFE65100))),
        ],
      ),
    );
  }

  Widget _buildTimerSection() {
    if (_otpTimer == null || !_otpTimer!.isActive) return const SizedBox.shrink();
    final progress = _otpTimeRemaining / 300.0;
    final isUrgent = _otpTimeRemaining < 60;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isUrgent
              ? [const Color(0xFFFDE0DC), const Color(0xFFFCE4EC)]
              : [const Color(0xFFE3F2FD), const Color(0xFFE8EAF6)],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isUrgent ? const Color(0xFFEF9A9A) : const Color(0xFF90CAF9)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 56, height: 56,
            child: Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 56, height: 56,
                  child: CircularProgressIndicator(
                    value: progress,
                    strokeWidth: 5,
                    backgroundColor: Colors.grey[300],
                    valueColor: AlwaysStoppedAnimation(isUrgent ? Colors.red : const Color(0xFF1565C0)),
                  ),
                ),
                Text(
                  _formatTime(_otpTimeRemaining),
                  style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.bold, color: isUrgent ? Colors.red : const Color(0xFF1565C0)),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isUrgent ? 'Hurry! Time running out' : 'Waiting for rider',
                  style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 14, color: isUrgent ? Colors.red[700] : const Color(0xFF1565C0)),
                ),
                const SizedBox(height: 2),
                Text('Ride auto-cancels when timer expires', style: GoogleFonts.poppins(fontSize: 11, color: Colors.grey[600])),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons() {
    if (_rideStatus == 'pending') {
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _isDeclining ? null : _declineRide,
              icon: _isDeclining
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.close_rounded, size: 18),
              label: Text('Decline', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                padding: const EdgeInsets.symmetric(vertical: 16),
                side: const BorderSide(color: Colors.red, width: 1.5),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                gradient: const LinearGradient(colors: [Color(0xFF2E7D32), Color(0xFF43A047)]),
                boxShadow: [BoxShadow(color: const Color(0xFF2E7D32).withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))],
              ),
              child: ElevatedButton.icon(
                onPressed: _isAccepting ? null : _acceptRide,
                icon: _isAccepting
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Icon(Icons.check_circle_rounded, color: Colors.white, size: 20),
                label: Text('Accept Ride', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ),
          ),
        ],
      );
    }
    if (_rideStatus == 'matched') {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(colors: [Color(0xFF2E7D32), Color(0xFF66BB6A)]),
          boxShadow: [BoxShadow(color: const Color(0xFF2E7D32).withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))],
        ),
        child: ElevatedButton.icon(
          onPressed: _isLoading ? null : _handleArriveAtPickup,
          icon: _isLoading
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
              : const Icon(Icons.flag_rounded, color: Colors.white, size: 22),
          label: Text('Arrived at Pickup', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            shadowColor: Colors.transparent,
            minimumSize: const Size(double.infinity, 56),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      );
    }
    if (_rideStatus == 'arrived') {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(colors: [Color(0xFF1565C0), Color(0xFF42A5F5)]),
          boxShadow: [BoxShadow(color: const Color(0xFF1565C0).withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))],
        ),
        child: ElevatedButton.icon(
          onPressed: _showOtpDialog,
          icon: const Icon(Icons.pin_rounded, color: Colors.white, size: 22),
          label: Text('Enter OTP & Start Ride', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            shadowColor: Colors.transparent,
            minimumSize: const Size(double.infinity, 56),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      );
    }
    if (_rideStatus == 'in_progress') {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(colors: [Color(0xFF6A1B9A), Color(0xFFAB47BC)]),
          boxShadow: [BoxShadow(color: const Color(0xFF6A1B9A).withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))],
        ),
        child: ElevatedButton.icon(
          onPressed: _handleCompleteRide,
          icon: const Icon(Icons.check_circle_outline_rounded, color: Colors.white, size: 22),
          label: Text('Complete Ride', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            shadowColor: Colors.transparent,
            minimumSize: const Size(double.infinity, 56),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  /// Show OTP dialog with premium bottom sheet styling
  void _showOtpDialog() {
    _otpController.clear();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2))),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [Color(0xFF1565C0), Color(0xFF42A5F5)]),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [BoxShadow(color: const Color(0xFF1565C0).withValues(alpha: 0.3), blurRadius: 12, offset: const Offset(0, 4))],
                ),
                child: const Icon(Icons.pin_rounded, color: Colors.white, size: 32),
              ),
              const SizedBox(height: 16),
              Text('Enter Ride OTP', style: GoogleFonts.poppins(fontSize: 22, fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Text('Ask the rider for their 4-digit verification code', style: GoogleFonts.poppins(fontSize: 13, color: Colors.grey[600]), textAlign: TextAlign.center),
              const SizedBox(height: 24),
              TextField(
                controller: _otpController,
                keyboardType: TextInputType.number,
                maxLength: 4,
                textAlign: TextAlign.center,
                autofocus: true,
                style: GoogleFonts.poppins(fontSize: 36, fontWeight: FontWeight.bold, letterSpacing: 16, color: const Color(0xFF1565C0)),
                decoration: InputDecoration(
                  hintText: '• • • •',
                  hintStyle: GoogleFonts.poppins(fontSize: 36, color: Colors.grey[300], letterSpacing: 16),
                  counterText: '',
                  filled: true,
                  fillColor: Colors.grey[50],
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: Colors.grey[300]!)),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: Colors.grey[300]!)),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF1565C0), width: 2)),
                  contentPadding: const EdgeInsets.symmetric(vertical: 20),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(ctx),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        side: BorderSide(color: Colors.grey[400]!),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text('Cancel', style: GoogleFonts.poppins(color: Colors.grey[600], fontWeight: FontWeight.w500)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        gradient: const LinearGradient(colors: [Color(0xFF2E7D32), Color(0xFF43A047)]),
                        boxShadow: [BoxShadow(color: const Color(0xFF2E7D32).withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))],
                      ),
                      child: ElevatedButton.icon(
                        onPressed: () async {
                          final otp = _otpController.text.trim();
                          if (otp.length != 4) {
                            ScaffoldMessenger.of(ctx).showSnackBar(
                              const SnackBar(content: Text('Please enter a valid 4-digit OTP'), backgroundColor: Colors.red),
                            );
                            return;
                          }
                          Navigator.pop(ctx);
                          await _handleStartRide(otp);
                        },
                        icon: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 22),
                        label: Text('Start Trip', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.transparent,
                          shadowColor: Colors.transparent,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
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

