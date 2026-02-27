import 'dart:async';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:location/location.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../../core/services/map_service.dart';
import '../../auth/screens/login_screen.dart';

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
  bool _isSearchingForDriver = false; // NEW state for ride request

    @override
  void initState() {
    super.initState();
    _loadUserData();
    _getCurrentLocation();
    _pickupController.addListener(() => _onSearchChanged(isPickup: true));
    _searchController.addListener(() => _onSearchChanged(isPickup: false));
  }

  Future<void> _useCurrentLocationForPickup() async {
    // 1. Check Permissions & Get Location if needed
    if (_currentPosition == null) {
      await _getCurrentLocation(); 
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unable to fetch current location.')),
      );
    }
  }

  Future<void> _handleRequestRide() async {
    if (_estimateData == null || _pickupPosition == null || _destinationPosition == null) return;

    setState(() => _isSearchingForDriver = true);

    final result = await MapService.requestRide(
      pickup: _pickupPosition!,
      drop: _destinationPosition!,
      fare: (_estimateData!['fare'] as num).toDouble(),
      distance: _estimateData!['distance_value'] is int ? (_estimateData!['distance_value'] as int) / 1000 : 0.0, // approx
      duration: _estimateData!['duration_value'] is int ? (_estimateData!['duration_value'] as int) / 60 : 0.0, // approx
      polyline: _estimateData!['polyline'] ?? '',
    );

    if (mounted) {
      if (result != null) {
        // In a real app, we'd now listen to Firestore for driver acceptance.
        // For this demo/MVP, we'll simulate a "Driver Found" after a delay or just keep showing searching.
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ride Requested! Waiting for drivers...')),
        );
      } else {
        setState(() => _isSearchingForDriver = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to request ride. Please try again.')),
        );
      }
    }
  }

  Widget _buildSearchingSheet() {
    return Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          width: double.infinity,
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 20,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 8),
              const CircularProgressIndicator(),
              const SizedBox(height: 24),
              Text(
                'Contacting nearby drivers...',
                style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text(
                'Please wait while we find you a ride.',
                style: GoogleFonts.poppins(color: Colors.grey),
              ),
              const SizedBox(height: 24),
              OutlinedButton(
                onPressed: () {
                   // Cancel request logic would go here
                   setState(() => _isSearchingForDriver = false);
                },
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 50),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Cancel Request'),
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
    _debounce = Timer(const Duration(milliseconds: 500), () {
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(points.length < 5 
              ? 'Warning: Route data incomplete. Showing partial path.' 
              : 'Route found: ${result['distance']} (${result['duration']})'),
            backgroundColor: points.length < 5 ? Colors.orange : const Color(0xFF007AFF),
            duration: const Duration(seconds: 5),
            behavior: SnackBarBehavior.floating,
          ),
        );

        _updateCamera();
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

  @override
  void dispose() {
    _debounce?.cancel();
    _pickupController.dispose();
    _searchController.dispose();
    super.dispose();
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
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
              child: Column(
                children: [
                   _buildTopBar(),
                   const SizedBox(height: 12),
                   _buildRouteCard(),
                ],
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
            initialChildSize: 0.4,
            minChildSize: 0.35,
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
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.2),
                        blurRadius: 10,
                        offset: const Offset(0, -5),
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
                            width: 40,
                            height: 4,
                            margin: const EdgeInsets.only(bottom: 20),
                            decoration: BoxDecoration(
                              color: Colors.grey[600],
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ),
                        _buildMainActions(),
                        const SizedBox(height: 24),
                        Text(
                          'Quick Actions',
                          style: GoogleFonts.poppins(
                            color: AppColors.textPrimary,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 12),
                        _buildQuickActionCards(),
                        const SizedBox(height: 24),
                        Text(
                          'Your Impact 🌍',
                          style: GoogleFonts.poppins(
                            color: AppColors.primary,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 12),
                        _buildImpactStats(),
                        const SizedBox(height: 24),
                        Text(
                          'Nearby Drivers',
                          style: GoogleFonts.poppins(
                             color: AppColors.textPrimary,
                             fontSize: 16,
                             fontWeight: FontWeight.w600,
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
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.surface,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(color: Colors.black.withOpacity(0.1), blurRadius: 10, offset: const Offset(0, 4)),
              ],
            ),
            child: const Icon(Icons.menu, color: AppColors.textPrimary, size: 24),
          ),
        ),
        const Spacer(),
        _buildRoleSwitch(),
        const SizedBox(width: 12),
        _buildUserAvatar(),
      ],
    );
  }

  Widget _buildRoleSwitch() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.primary.withOpacity(0.5)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 8),
        ],
      ),
      child: Text(
        'Rider',
        style: GoogleFonts.poppins(
          color: AppColors.primary,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildUserAvatar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(30),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 8),
        ],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: AppColors.primary,
            backgroundImage: _userPhoto != null ? NetworkImage(_userPhoto!) : null,
            child: _userPhoto == null ? const Icon(Icons.person, size: 16, color: Colors.white) : null,
          ),
          const SizedBox(width: 8),
          Text(
            _userName?.split(' ')[0] ?? 'User',
            style: GoogleFonts.poppins(
              color: Colors.black,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteCard() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.1), blurRadius: 20, offset: const Offset(0, 10)),
        ],
        border: Border.all(color: Colors.grey.withOpacity(0.1)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Pickup Field
          _buildSearchField(
            controller: _pickupController,
            hint: 'Search Pickup Location...',
            icon: Icons.my_location,
            iconColor: Colors.blue,
            isPickup: true,
          ),
          
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Divider(height: 1, thickness: 0.5),
          ),

          // Destination Field
          _buildSearchField(
            controller: _searchController,
            hint: 'Search Destination...',
            icon: Icons.location_on,
            iconColor: Colors.red,
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
              style: GoogleFonts.poppins(color: Colors.black, fontSize: 14, fontWeight: FontWeight.w500),
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: GoogleFonts.poppins(color: Colors.black45, fontSize: 14),
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
                    style: GoogleFonts.poppins(color: Colors.blue, fontSize: 13, fontWeight: FontWeight.w600),
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
                  style: GoogleFonts.poppins(color: Colors.black87, fontSize: 13),
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
              style: GoogleFonts.poppins(
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
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 20,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Handle Drag Indicator
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 20),

              // Title
              Text(
                'Ride Estimate',
                style: GoogleFonts.poppins(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
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
                           color: AppColors.primary.withOpacity(0.1),
                           borderRadius: BorderRadius.circular(12),
                         ),
                         child: const Icon(Icons.currency_rupee, color: AppColors.primary),
                       ),
                       const SizedBox(width: 12),
                       Column(
                         crossAxisAlignment: CrossAxisAlignment.start,
                         children: [
                           Text(
                             'Estimated Fare',
                             style: GoogleFonts.poppins(
                               color: AppColors.textSecondary,
                               fontSize: 12,
                             ),
                           ),
                           Text(
                             '₹${_estimateData!['fare']}',
                             style: GoogleFonts.poppins(
                               color: AppColors.textPrimary,
                               fontSize: 24,
                               fontWeight: FontWeight.bold,
                             ),
                           ),
                         ],
                       ),
                     ],
                   ),
                   
                   // ETA
                   Container(
                     padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                     decoration: BoxDecoration(
                       color: AppColors.offWhite,
                       borderRadius: BorderRadius.circular(20),
                     ),
                     child: Row(
                       children: [
                         const Icon(Icons.timer_outlined, size: 16, color: Colors.blue),
                         const SizedBox(width: 4),
                         Text(
                           '${_estimateData!['eta_min']} min',
                           style: GoogleFonts.poppins(
                             fontWeight: FontWeight.w600,
                             fontSize: 14,
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
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Colors.green[50]!, Colors.green[100]!],
                  ),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.green[200]!),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.eco, color: AppColors.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Green Choice',
                            style: GoogleFonts.poppins(
                              color: AppColors.primaryDark,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                          Text(
                            'You save ${_estimateData!['co2_saved_g']}g of CO2 with this Eco-Ride!',
                            style: GoogleFonts.poppins(
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
                    child: OutlinedButton(
                      onPressed: () {
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
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        side: const BorderSide(color: Colors.grey),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text('Cancel', style: GoogleFonts.poppins(color: Colors.black)),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _handleRequestRide,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                         shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                         elevation: 0,
                      ),
                      child: Text('Request Ride', style: GoogleFonts.poppins(fontWeight: FontWeight.bold)),
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
                  style: GoogleFonts.poppins(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                Text(
                  subtitle,
                  style: GoogleFonts.poppins(
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
          style: GoogleFonts.poppins(
            color: AppColors.primary,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: GoogleFonts.poppins(
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
                  Text('0', style: GoogleFonts.poppins(color: AppColors.primary, fontSize: 24, fontWeight: FontWeight.bold)),
                  Text('Available', style: GoogleFonts.poppins(color: AppColors.textSecondary, fontSize: 12)),
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
                   Text('0', style: GoogleFonts.poppins(color: Colors.orange, fontSize: 24, fontWeight: FontWeight.bold)),
                  Text('Busy', style: GoogleFonts.poppins(color: AppColors.textSecondary, fontSize: 12)),
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
            accountName: Text(_userName ?? 'User', style: GoogleFonts.poppins(fontWeight: FontWeight.bold)),
            accountEmail: Text(_userEmail ?? '', style: GoogleFonts.poppins()),
          ),
          ListTile(
            leading: const Icon(Icons.history, color: AppColors.textPrimary),
            title: Text('Ride History', style: GoogleFonts.poppins(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.payment, color: AppColors.textPrimary),
            title: Text('Payment Methods', style: GoogleFonts.poppins(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.card_giftcard, color: AppColors.textPrimary),
            title: Text('Promos', style: GoogleFonts.poppins(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.help_outline, color: AppColors.textPrimary),
            title: Text('Support', style: GoogleFonts.poppins(color: AppColors.textPrimary)),
            onTap: () {},
          ),
          const Spacer(),
          const Divider(color: AppColors.lightGrey),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: Text('Logout', style: GoogleFonts.poppins(color: Colors.red)),
            onTap: _handleLogout,
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}
