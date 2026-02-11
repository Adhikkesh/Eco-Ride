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
  StreamSubscription<DatabaseEvent>? _rideSubscription; // ADDED THIS LINE
  Map<dynamic, dynamic>? _currentRide; // Data for incoming/active ride
  bool _isNavigating = false;
  Set<Marker> _markers = {};
  Set<Polyline> _polylines = {};
  
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
      final initialLocation = await _location.getLocation().timeout(const Duration(seconds: 10));
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

      // Listen for ride assignments
      final userId = _auth.currentUser?.uid;
      if (userId != null) {
        debugPrint('DriverHome: Listening for rides at rides-assigned/$userId');
        _rideSubscription = _rtdb.ref('rides-assigned/$userId').onValue.listen((event) {
          final data = event.snapshot.value as Map<dynamic, dynamic>?;
          if (data != null) {
             debugPrint('DriverHome: NEW RIDE RECEIVED! $data');
             setState(() {
               _currentRide = data;
             });
             // TODO: Trigger notification sound/vibration
          } else {
             // Ride removed/cancelled
            if (_currentRide != null) {
               debugPrint('DriverHome: Ride assignment removed.');
               setState(() {
                 _currentRide = null; 
                 _isNavigating = false;
                 _polylines.clear();
                 _markers.clear();
               });
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

  Future<void> _acceptRide() async {
    if (_currentRide == null || _currentPosition == null) return;

    final rideData = _currentRide!;
    final pickupData = rideData['pickup'];
    final dropData = rideData['drop'];

    final LatLng pickup = LatLng(
      (pickupData['lat'] as num).toDouble(),
      (pickupData['lng'] as num).toDouble(),
    );
    final LatLng drop = LatLng(
      (dropData['lat'] as num).toDouble(),
      (dropData['lng'] as num).toDouble(),
    );

    setState(() => _isLoading = true);

    try {
      // 1. Leg 1: Driver to Pickup (BLUE)
      final directionsToPickup = await MapService.getDirections(_currentPosition!, pickup);
      
      // 2. Leg 2: Pickup to Drop (GREEN)
      final directionsToDrop = await MapService.getDirections(pickup, drop);

      if (mounted) {
        setState(() {
          _isNavigating = true;
          _isLoading = false;
          
          _markers.clear();
          _markers.add(Marker(
            markerId: const MarkerId('pickup'),
            position: pickup,
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
            infoWindow: const InfoWindow(title: 'Pickup Location'),
          ));
          _markers.add(Marker(
            markerId: const MarkerId('dropoff'),
            position: drop,
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
            infoWindow: const InfoWindow(title: 'Destination'),
          ));

          _polylines.clear();
          if (directionsToPickup != null) {
            _polylines.add(Polyline(
              polylineId: const PolylineId('to_pickup'),
              points: directionsToPickup['points'],
              color: Colors.blue,
              width: 5,
            ));
          }
          if (directionsToDrop != null) {
            _polylines.add(Polyline(
              polylineId: const PolylineId('to_dropoff'),
              points: directionsToDrop['points'],
              color: Colors.green,
              width: 5,
            ));
          }
        });

        // Zoom to fit both legs
        final controller = await _controller.future;
        final bounds = _getBounds([_currentPosition!, pickup, drop]);
        controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 100));

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Navigation started!')),
        );
      }
    } catch (e) {
      debugPrint('DriverHome: Error accepting ride: $e');
      if (mounted) setState(() => _isLoading = false);
    }
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
          
          // 3. Incoming Ride Sheet
          if (_currentRide != null) 
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
    if (_currentRide == null) return const SizedBox.shrink();
    
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
           BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 20, offset: const Offset(0, -5)),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                _isNavigating ? 'Active Trip' : 'New Ride Request!', 
                style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.black)
              ),
              if (!_isNavigating)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(20)),
                  child: Text('2 min away', style: GoogleFonts.poppins(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                ),
            ],
          ),
          const SizedBox(height: 16),
          // Route Details
          Row(children: [
             const Icon(Icons.my_location, color: Colors.green),
             const SizedBox(width: 12),
             Expanded(child: Text('Pickup Location', style: GoogleFonts.poppins(fontSize: 14))),
          ]),
          Padding(
            padding: const EdgeInsets.only(left: 11, top: 4, bottom: 4),
            child: Container(height: 20, width: 2, color: Colors.grey.withOpacity(0.3)),
          ),
          Row(children: [
             const Icon(Icons.location_on, color: Colors.red),
             const SizedBox(width: 12),
             Expanded(child: Text('Drop Location', style: GoogleFonts.poppins(fontSize: 14))),
          ]),
          
          const SizedBox(height: 24),
          
          if (!_isNavigating)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                       // Reject logic
                       setState(() => _currentRide = null); 
                    },
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      side: BorderSide(color: Colors.red.withOpacity(0.5)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Decline', style: GoogleFonts.poppins(color: Colors.red)),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _acceptRide,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                       padding: const EdgeInsets.symmetric(vertical: 16),
                       shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Accept Ride', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            )
          else
            ElevatedButton(
              onPressed: () {
                // Next step: Start Ride
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Arrived at Pickup!')));
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                minimumSize: const Size(double.infinity, 54),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text('Arrived at Pickup', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
        ],
      ),
    );
  }
}
