import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/services/auth_service.dart';
import '../constants/app_constants.dart';

class MapService {
  // Persistent HTTP client to avoid iOS socket exhaustion (errno 48)
  static final http.Client _client = http.Client();
  static const String _autocompleteUrl = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  static const String _detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
  static const String _directionsUrl = 'https://maps.googleapis.com/maps/api/directions/json';

  // Simulation data for Web/CORS bypass
  static const Map<String, Map<String, dynamic>> _simulatedPlaces = {
    'ettimadai': {
      'description': 'Ettimadai, Coimbatore, Tamil Nadu, India',
      'place_id': 'sim_ettimadai',
      'lat': 10.9015,
      'lng': 76.8992,
    },
    'coimbatore junction': {
      'description': 'Coimbatore Junction Railway Station, Gopalapuram, Coimbatore',
      'place_id': 'sim_cbe_junction',
      'lat': 10.9980,
      'lng': 76.9666,
    },
    'coimbatore airport': {
      'description': 'Coimbatore International Airport (CJB), Peelamedu, Coimbatore',
      'place_id': 'sim_cbe_airport',
      'lat': 11.0300,
      'lng': 77.0434,
    },
    'brookefields mall': {
      'description': 'Brookefields Mall, Krishnaswamy Rd, Coimbatore',
      'place_id': 'sim_brookefields',
      'lat': 11.0085,
      'lng': 76.9600,
    },
    'prozone mall': {
      'description': 'Prozone Mall, Sathy Rd, Saravanampatti, Coimbatore',
      'place_id': 'sim_prozone',
      'lat': 11.0545,
      'lng': 76.9942,
    },
    'psg tech': {
      'description': 'PSG College of Technology, Peelamedu, Coimbatore',
      'place_id': 'sim_psg_tech',
      'lat': 11.0247,
      'lng': 77.0033,
    },
    'coimbatore': {
      'description': 'Coimbatore, Tamil Nadu, India',
      'place_id': 'sim_coimbatore',
      'lat': 11.0168,
      'lng': 76.9558,
    },
    'gandhipuram': {
      'description': 'Gandhipuram, Coimbatore, Tamil Nadu, India',
      'place_id': 'sim_gandhipuram',
      'lat': 11.0183,
      'lng': 76.9644,
    },
    'saravanampatti': {
      'description': 'Saravanampatti, Coimbatore, Tamil Nadu, India',
      'place_id': 'sim_saravanampatti',
      'lat': 11.0805,
      'lng': 76.9926,
    },
    'marudhamalai': {
      'description': 'Marudhamalai Adivaram, Coimbatore, Tamil Nadu, India',
      'place_id': 'sim_marudhamalai',
      'lat': 11.0374,
      'lng': 76.8837,
    },
  };

  static Future<List<Map<String, dynamic>>> getPlaceSuggestions(String input) async {
    if (input.isEmpty) return [];

    final query = input.toLowerCase();
    
    // 1. Prepare the real API URL
    final apiUri = '$_autocompleteUrl?input=${Uri.encodeComponent(input)}&key=${ApiConfig.googleMapsApiKey}';
    
    // 2. Try multiple proxies on Web
    if (kIsWeb) {
      final proxies = [
        'https://corsproxy.io/?${Uri.encodeComponent(apiUri)}',
        'https://api.allorigins.win/raw?url=${Uri.encodeComponent(apiUri)}',
      ];

      for (var proxyUrl in proxies) {
        try {
          debugPrint('MapService: Trying proxy: $proxyUrl');
          final response = await _client.get(Uri.parse(proxyUrl)).timeout(const Duration(seconds: 4));
          if (response.statusCode == 200) {
            final data = json.decode(response.body);
            if (data['status'] == 'OK') {
              return List<Map<String, dynamic>>.from(data['predictions']);
            }
          }
        } catch (e) {
          debugPrint('MapService: Proxy failed ($e)');
        }
      }
    } else {
      // On Mobile, just call directly
      try {
        final response = await _client.get(Uri.parse(apiUri)).timeout(const Duration(seconds: 3));
        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['status'] == 'OK') {
            return List<Map<String, dynamic>>.from(data['predictions']);
          }
        }
      } catch (e) {
        debugPrint('MapService Mobile Error: $e');
      }
    }

    // 3. Fallback to simulation
    List<Map<String, dynamic>> suggestions = [];
    _simulatedPlaces.forEach((key, value) {
      if (key.contains(query)) {
        suggestions.add({
          'description': value['description'],
          'place_id': value['place_id'],
        });
      }
    });

    return suggestions; 
  }

  static Future<Map<String, double>?> getPlaceDetails(String placeId) async {
    debugPrint('MapService: Getting details for $placeId');
    for (var place in _simulatedPlaces.values) {
      if (place['place_id'] == placeId) {
        debugPrint('MapService: Found simulated location: ${place['lat']}, ${place['lng']}');
        return {
          'lat': place['lat'] as double,
          'lng': place['lng'] as double,
        };
      }
    }

    final apiUri = '$_detailsUrl?place_id=$placeId&key=${ApiConfig.googleMapsApiKey}';
    
    if (kIsWeb) {
      final proxies = [
        'https://api.allorigins.win/raw?url=${Uri.encodeComponent(apiUri)}',
        'https://corsproxy.io/?${Uri.encodeComponent(apiUri)}',
      ];

      for (var proxyUrl in proxies) {
        try {
          debugPrint('MapService: Details Proxy: $proxyUrl');
          final response = await _client.get(Uri.parse(proxyUrl)).timeout(const Duration(seconds: 4));
          if (response.statusCode == 200) {
            final data = json.decode(response.body);
            if (data['status'] == 'OK') {
              final location = data['result']['geometry']['location'];
              debugPrint('MapService: Real Location Found: ${location['lat']}, ${location['lng']}');
              return {
                'lat': (location['lat'] as num).toDouble(),
                'lng': (location['lng'] as num).toDouble(),
              };
            }
          }
        } catch (e) {
          debugPrint('MapService Details Proxy failed: $e');
        }
      }
    } else {
      try {
        final response = await _client.get(Uri.parse(apiUri)).timeout(const Duration(seconds: 5));
        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['status'] == 'OK') {
            final location = data['result']['geometry']['location'];
            return {
              'lat': (location['lat'] as num).toDouble(),
              'lng': (location['lng'] as num).toDouble(),
            };
          }
        }
      } catch (e) {
        debugPrint('MapService Details Mobile Error: $e');
      }
    }
    return null;
  }

  static Future<Map<String, dynamic>?> getDirections(LatLng origin, LatLng destination) async {
    debugPrint('MapService: Directions from ${origin.latitude},${origin.longitude} to ${destination.latitude},${destination.longitude}');
    
    final originStr = '${origin.latitude},${origin.longitude}';
    final destStr = '${destination.latitude},${destination.longitude}';
    final apiUri = '$_directionsUrl?origin=$originStr&destination=$destStr&key=${ApiConfig.googleMapsApiKey}';

    if (kIsWeb) {
      final proxies = [
        'https://api.allorigins.win/raw?url=${Uri.encodeComponent(apiUri)}',
        'https://corsproxy.io/?${Uri.encodeComponent(apiUri)}',
      ];

      for (var url in proxies) {
        try {
          debugPrint('MapService: Fetching directions via $url');
          final response = await _client.get(Uri.parse(url)).timeout(const Duration(seconds: 5));
          if (response.statusCode == 200) {
            final data = json.decode(response.body);
            if (data['status'] == 'OK') {
              final route = data['routes'][0];
              final polyline = route['overview_polyline']['points'];
              final leg = route['legs'][0];
              
              debugPrint('MapService: Received Polyline string (length ${polyline.length})');
              final points = _decodePolyline(polyline);
              debugPrint('MapService: Decoded ${points.length} points');
              if (points.isNotEmpty) {
                debugPrint('MapService: First Point: ${points.first.latitude}, ${points.first.longitude}');
                debugPrint('MapService: Last Point: ${points.last.latitude}, ${points.last.longitude}');
              }

              return {
                'points': points,
                'distance': leg['distance']['text'],
                'duration': leg['duration']['text'],
              };
            } else {
              debugPrint('MapService Directions API Error Status: ${data['status']}');
            }
          }
        } catch (e) {
          debugPrint('MapService Directions Proxy Error: $e');
        }
      }
    } else {
      try {
        final response = await _client.get(Uri.parse(apiUri)).timeout(const Duration(seconds: 5));
        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['status'] == 'OK') {
            final route = data['routes'][0];
            final polyline = route['overview_polyline']['points'];
            final leg = route['legs'][0];
            return {
              'points': _decodePolyline(polyline),
              'distance': leg['distance']['text'],
              'duration': leg['duration']['text'],
            };
          }
        }
      } catch (e) {
        debugPrint('MapService Directions Mobile Error: $e');
      }
    }

    return null;
  }

  static Future<Map<String, dynamic>?> getRideEstimate(LatLng pickup, LatLng drop, {bool isPooled = false}) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) {
        debugPrint('MapService: User not authenticated for estimate');
        return null;
      }

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.estimateRide}');
      debugPrint('MapService: Requesting estimate from $url (pooled=$isPooled)');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'pickup': {'lat': pickup.latitude, 'lng': pickup.longitude},
          'drop': {'lat': drop.latitude, 'lng': drop.longitude},
          'isPooled': isPooled,
        }),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          debugPrint('MapService: Estimate received: ${data['fare']} ${data['currency']}');
          return data;
        } else {
          debugPrint('MapService: Backend returned error: ${data['message']}');
        }
      } else {
        debugPrint('MapService: Estimate API error: ${response.statusCode} - ${response.body}');
      }
    } catch (e) {
      debugPrint('MapService: Fatal error getting estimate: $e');
    }
    return null;
  }

  static Future<Map<String, dynamic>?> requestRide({
    required LatLng pickup,
    required LatLng drop,
    required double fare,
    required double distance,
    required double duration,
    required String polyline,
    bool isPooled = false,
    double co2Saved = 0,
  }) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) {
        debugPrint('MapService: User not authenticated for request');
        return null; // Force auth check
      }

      // Get rider UID — backend requires riderId in request body
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) {
        debugPrint('MapService: No current user UID');
        return null;
      }

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.requestRide}');
      debugPrint('MapService: Requesting ride at $url (pooled=$isPooled)');

      // Match backend expected fields exactly (same as web app RiderMap.tsx)
      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'riderId': uid,
          'pickupLat': pickup.latitude,
          'pickupLng': pickup.longitude,
          'dropLat': drop.latitude,
          'dropLng': drop.longitude,
          'pickupName': 'Pickup Location',
          'dropName': 'Destination',
          'fare': fare,
          'distance': distance,
          'duration': duration,
          'co2Saved': co2Saved,
          'isPooled': isPooled,
        }),
      );

      debugPrint('MapService: Request ride status: ${response.statusCode}');
      debugPrint('MapService: Request ride body: ${response.body}');
      if (response.statusCode == 201 || response.statusCode == 200) {
        final data = json.decode(response.body);
        return data;
      } else {
        debugPrint('MapService: Request ride FAILED: ${response.body}');
        return null;
      }
    } catch (e) {
      debugPrint('MapService: Error requesting ride: $e');
      return null;
    }
  }


  // =========================================================================
  // Ride Lifecycle API Methods
  // =========================================================================

  /// Accept a pending ride (driver side)
  static Future<Map<String, dynamic>?> acceptRide(String rideId) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.acceptRide}');
      debugPrint('MapService: Accepting ride $rideId at $url');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId}),
      );

      debugPrint('MapService: Accept ride status: ${response.statusCode}');
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        debugPrint('MapService: Accept ride failed: ${response.body}');
        return json.decode(response.body);
      }
    } catch (e) {
      debugPrint('MapService: Error accepting ride: $e');
      return null;
    }
  }

  /// Decline a pending ride (driver side)
  static Future<Map<String, dynamic>?> declineRide(String rideId) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final userId = FirebaseAuth.instance.currentUser?.uid;
      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.declineRide}');
      debugPrint('MapService: Declining ride $rideId');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId, 'driverId': userId}),
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return null;
    } catch (e) {
      debugPrint('MapService: Error declining ride: $e');
      return null;
    }
  }

  /// Mark arrival at pickup (driver side)
  static Future<Map<String, dynamic>?> arriveAtPickup(String rideId) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.arriveAtPickup}');
      debugPrint('MapService: Marking arrival for ride $rideId');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId}),
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        debugPrint('MapService: Arrive at pickup failed: ${response.body}');
        return null;
      }
    } catch (e) {
      debugPrint('MapService: Error marking arrival: $e');
      return null;
    }
  }

  /// Start ride after OTP verification (driver side)
  static Future<Map<String, dynamic>?> startRide(String rideId, String otp) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.startRide}');
      debugPrint('MapService: Starting ride $rideId with OTP');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId, 'otp': otp}),
      );

      debugPrint('MapService: Start ride status: ${response.statusCode}');
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        debugPrint('MapService: Start ride failed: ${response.body}');
        return json.decode(response.body);
      }
    } catch (e) {
      debugPrint('MapService: Error starting ride: $e');
      return null;
    }
  }

  /// Complete a ride (driver side)
  static Future<Map<String, dynamic>?> completeRide(String rideId) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.completeRide}');
      debugPrint('MapService: Completing ride $rideId');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId}),
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        debugPrint('MapService: Complete ride failed: ${response.body}');
        return null;
      }
    } catch (e) {
      debugPrint('MapService: Error completing ride: $e');
      return null;
    }
  }

  /// Cancel a ride (rider side)
  static Future<Map<String, dynamic>?> cancelRide(String rideId) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.cancelRide}');
      debugPrint('MapService: Cancelling ride $rideId');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId}),
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return null;
    } catch (e) {
      debugPrint('MapService: Error cancelling ride: $e');
      return null;
    }
  }

  /// Get active ride for current rider
  static Future<Map<String, dynamic>?> getActiveRide() async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.activeRide}');
      debugPrint('MapService: Checking active ride');

      final response = await _client.get(
        url,
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return null;
    } catch (e) {
      debugPrint('MapService: Error checking active ride: $e');
      return null;
    }
  }

  /// Get OTP for a ride (rider polls this; available when driver is within 100m)
  static Future<Map<String, dynamic>?> getOtp(String rideId) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.getOtp}/$rideId');
      debugPrint('MapService: Checking OTP for ride $rideId');

      final response = await _client.get(
        url,
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return null;
    } catch (e) {
      debugPrint('MapService: Error getting OTP: $e');
      return null;
    }
  }

  /// Submit a rating for a completed ride
  static Future<Map<String, dynamic>?> submitRating({
    required String rideId,
    required String driverId,
    required int rating,
    String comment = '',
  }) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.rateRide}');
      debugPrint('MapService: Submitting rating for ride $rideId (stars=$rating)');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'rideId': rideId,
          'driverId': driverId,
          'rating': rating,
          'comment': comment,
        }),
      );

      debugPrint('MapService: Rating submit status: ${response.statusCode}');
      if (response.statusCode == 200) {
        return json.decode(response.body);
      } else {
        debugPrint('MapService: Rating submit failed: ${response.body}');
        return json.decode(response.body);
      }
    } catch (e) {
      debugPrint('MapService: Error submitting rating: $e');
      return null;
    }
  }


  static List<LatLng> decodePolyline(String encoded) {
    return _decodePolyline(encoded);
  }

  static List<LatLng> _decodePolyline(String encoded) {
    // Some proxies escape backslashes (\ to \\), which breaks the encoder.
    // We clean the string before processing.
    String pointsString = encoded.replaceAll('\\\\', '\\');
    
    List<LatLng> points = [];
    int index = 0;
    int len = pointsString.length;
    int lat = 0;
    int lng = 0;

    debugPrint('MapService: Decoding polyline. Original len: ${encoded.length}, Cleaned len: $len');

    try {
      while (index < len) {
        int b, shift = 0, result = 0;
        do {
          b = pointsString.codeUnitAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        
        // Use .toSigned(32) to ensure Dart's 64-bit ints behave like 32-bit signed deltas
        int dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1)).toSigned(32);
        lat += dlat;

        shift = 0;
        result = 0;
        do {
          b = pointsString.codeUnitAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        
        int dlng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1)).toSigned(32);
        lng += dlng;

        double finalLat = lat / 100000.0;
        double finalLng = lng / 100000.0;

        // Diagnostic logs for first few points to catch drift early
        if (points.length < 3) {
          debugPrint('MapService: Decoded point #${points.length}: $finalLat, $finalLng');
        }

        // Sanity Check: If a point jumps more than 1 degree suddenly, it's corrupt data.
        if (points.isNotEmpty) {
          double prevLat = points.last.latitude;
          double prevLng = points.last.longitude;
          if ((finalLat - prevLat).abs() > 1.0 || (finalLng - prevLng).abs() > 1.0) {
            debugPrint('MapService: !!! Decode ABORTED at point #${points.length} due to coordinate JUMP.');
            debugPrint('MapService: prev($prevLat,$prevLng) -> curr($finalLat,$finalLng)');
            break; 
          }
        }

        if (finalLat >= -90 && finalLat <= 90 && finalLng >= -180 && finalLng <= 180) {
          points.add(LatLng(finalLat, finalLng));
        }
      }
    } catch (e) {
      debugPrint('MapService: Fatal error in polyline decoder: $e');
    }
    
    debugPrint('MapService: Final polyline point count: ${points.length}');
    return points;
  }

  // ===== Payment =====

  /// Create a Stripe PaymentIntent for a completed ride
  static Future<Map<String, dynamic>?> createPaymentIntent(String rideId) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.createPaymentIntent}');
      debugPrint('MapService: Creating payment intent for ride $rideId');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId}),
      );

      debugPrint('MapService: Payment intent status: ${response.statusCode}');
      return json.decode(response.body);
    } catch (e) {
      debugPrint('MapService: Error creating payment intent: $e');
      return null;
    }
  }

  /// Confirm payment after Stripe succeeds
  static Future<Map<String, dynamic>?> confirmPayment(String rideId, double amount) async {
    try {
      final token = await AuthService.instance.getIdToken();
      if (token == null) return null;

      final url = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.confirmPayment}');
      debugPrint('MapService: Confirming payment for ride $rideId, amount: $amount');

      final response = await _client.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({'rideId': rideId, 'amount': amount}),
      );

      debugPrint('MapService: Confirm payment status: ${response.statusCode}');
      return json.decode(response.body);
    } catch (e) {
      debugPrint('MapService: Error confirming payment: $e');
      return null;
    }
  }
}
