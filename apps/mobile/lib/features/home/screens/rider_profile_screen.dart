import 'dart:io';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/services/auth_service.dart';
import '../../auth/screens/login_screen.dart';

/// Dedicated Rider Profile Page.
/// Displays and edits rider info: photo, name, phone, green points,
/// trust score, saved locations, and ride history.
class RiderProfileScreen extends StatefulWidget {
  const RiderProfileScreen({super.key});

  @override
  State<RiderProfileScreen> createState() => _RiderProfileScreenState();
}

class _RiderProfileScreenState extends State<RiderProfileScreen> {
  bool _isLoading = true;
  bool _isEditing = false;
  bool _isSaving = false;

  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();

  String? _photoUrl;
  String? _email;
  int _greenPoints = 0;
  double _trustScore = 0;
  Map<String, dynamic>? _savedLocations;
  List<Map<String, dynamic>> _rideHistory = [];

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      _email = user.email;
      _photoUrl = user.photoURL;
      _nameController.text = user.displayName ?? '';

      // Fetch Firestore user data
      final doc = await FirebaseFirestore.instance.collection('users').doc(user.uid).get();
      final data = doc.data();
      if (data != null) {
        _phoneController.text = data['phone_number']?.toString() ?? '';
        _greenPoints = (data['green_points'] as num?)?.toInt() ?? 0;
        _trustScore = (data['trust_score'] as num?)?.toDouble() ?? 0;
        final saved = data['saved_locations'];
        if (saved is Map) {
          _savedLocations = Map<String, dynamic>.from(saved);
        }
      }

      // Fetch ride history
      final ridesSnap = await FirebaseFirestore.instance
          .collection('rides')
          .where('riderId', isEqualTo: user.uid)
          .orderBy('createdAt', descending: true)
          .limit(10)
          .get();
      _rideHistory = ridesSnap.docs.map((d) {
        final data = d.data();
        data['id'] = d.id;
        return data;
      }).toList();
    } catch (e) {
      debugPrint('RiderProfile: Error loading: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handlePhotoUpload() async {
    try {
      final picker = ImagePicker();
      final image = await picker.pickImage(source: ImageSource.gallery, maxWidth: 512, imageQuality: 80);
      if (image == null) return;

      setState(() => _isSaving = true);
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      final ref = FirebaseStorage.instance.ref('profile_photos/${user.uid}.jpg');
      await ref.putFile(File(image.path));
      final url = await ref.getDownloadURL();

      await user.updatePhotoURL(url);
      await FirebaseFirestore.instance.collection('users').doc(user.uid).update({'photoURL': url});

      setState(() {
        _photoUrl = url;
        _isSaving = false;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Photo updated!'), backgroundColor: Color(0xFF22C55E)),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _isSaving = false);
      debugPrint('RiderProfile: Photo upload error: $e');
    }
  }

  Future<void> _handleSave() async {
    setState(() => _isSaving = true);
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      await user.updateDisplayName(_nameController.text.trim());
      await FirebaseFirestore.instance.collection('users').doc(user.uid).update({
        'name': _nameController.text.trim(),
        'phone_number': _phoneController.text.trim(),
      });

      setState(() {
        _isEditing = false;
        _isSaving = false;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated!'), backgroundColor: Color(0xFF22C55E)),
        );
      }
    } catch (e) {
      setState(() => _isSaving = false);
      debugPrint('RiderProfile: Save error: $e');
    }
  }

  Future<void> _handleLogout() async {
    try {
      await AuthService.instance.signOut();
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const LoginScreen()),
          (route) => false,
        );
      }
    } catch (e) {
      debugPrint('Logout error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('My Profile', style: GoogleFonts.inter(fontWeight: FontWeight.w800, fontSize: 20)),
        actions: [
          if (!_isEditing)
            IconButton(
              icon: const Icon(Icons.edit_rounded),
              onPressed: () => setState(() => _isEditing = true),
            )
          else
            TextButton(
              onPressed: _isSaving ? null : _handleSave,
              child: _isSaving
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF22C55E)))
          : SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Column(
                children: [
                  _buildPhotoSection(isDark),
                  const SizedBox(height: 24),
                  _buildStatsRow(isDark),
                  const SizedBox(height: 20),
                  _buildInfoCard(isDark),
                  const SizedBox(height: 16),
                  _buildSavedLocationsCard(isDark),
                  const SizedBox(height: 16),
                  _buildRideHistoryCard(isDark),
                  const SizedBox(height: 24),
                  _buildLogoutButton(),
                  const SizedBox(height: 32),
                ],
              ),
            ),
    );
  }

  Widget _buildPhotoSection(bool isDark) {
    return Column(
      children: [
        Stack(
          children: [
            CircleAvatar(
              radius: 52,
              backgroundColor: const Color(0xFF22C55E).withValues(alpha: 0.15),
              backgroundImage: _photoUrl != null ? NetworkImage(_photoUrl!) : null,
              child: _photoUrl == null
                  ? const Icon(Icons.person_rounded, size: 48, color: Color(0xFF22C55E))
                  : null,
            ),
            Positioned(
              bottom: 0,
              right: 0,
              child: GestureDetector(
                onTap: _handlePhotoUpload,
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [Color(0xFF22C55E), Color(0xFF10B981)]),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                  ),
                  child: const Icon(Icons.camera_alt_rounded, size: 16, color: Colors.white),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          _nameController.text.isNotEmpty ? _nameController.text : 'Rider',
          style: GoogleFonts.inter(fontSize: 22, fontWeight: FontWeight.w800),
        ),
        Text(_email ?? '', style: GoogleFonts.inter(fontSize: 13, color: Colors.grey[600])),
      ],
    );
  }

  Widget _buildStatsRow(bool isDark) {
    return Row(
      children: [
        Expanded(child: _buildStatCard(
          icon: Icons.eco_rounded,
          label: 'Green Points',
          value: '$_greenPoints',
          gradient: const [Color(0xFF22C55E), Color(0xFF10B981)],
          isDark: isDark,
        )),
        const SizedBox(width: 12),
        Expanded(child: _buildStatCard(
          icon: Icons.verified_user_rounded,
          label: 'Trust Score',
          value: _trustScore.toStringAsFixed(1),
          gradient: const [Color(0xFF3B82F6), Color(0xFF2563EB)],
          isDark: isDark,
        )),
      ],
    );
  }

  Widget _buildStatCard({
    required IconData icon,
    required String label,
    required String value,
    required List<Color> gradient,
    required bool isDark,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: gradient),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: Colors.white, size: 22),
          ),
          const SizedBox(height: 10),
          Text(value, style: GoogleFonts.inter(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(label, style: GoogleFonts.inter(fontSize: 11, color: Colors.grey[600])),
        ],
      ),
    );
  }

  Widget _buildInfoCard(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Personal Info', style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 16),
          _buildField(Icons.person_rounded, 'Name', _nameController, _isEditing),
          const Divider(height: 24),
          _buildField(Icons.email_rounded, 'Email', null, false, value: _email),
          const Divider(height: 24),
          _buildField(Icons.phone_rounded, 'Phone', _phoneController, _isEditing),
        ],
      ),
    );
  }

  Widget _buildField(IconData icon, String label, TextEditingController? controller, bool editable, {String? value}) {
    return Row(
      children: [
        Icon(icon, size: 20, color: const Color(0xFF22C55E)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: GoogleFonts.inter(fontSize: 11, color: Colors.grey[500])),
              const SizedBox(height: 2),
              editable && controller != null
                  ? TextField(
                      controller: controller,
                      style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w500),
                      decoration: const InputDecoration(
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(vertical: 4),
                        border: UnderlineInputBorder(),
                      ),
                    )
                  : Text(
                      value ?? controller?.text ?? '',
                      style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w500),
                    ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSavedLocationsCard(bool isDark) {
    final locations = [
      {'key': 'home', 'icon': Icons.home_rounded, 'color': const Color(0xFF3B82F6)},
      {'key': 'work', 'icon': Icons.work_rounded, 'color': const Color(0xFFF59E0B)},
      {'key': 'favourite', 'icon': Icons.star_rounded, 'color': const Color(0xFFEF4444)},
    ];

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Saved Locations', style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 12),
          ...locations.map((loc) {
            final key = loc['key'] as String;
            final data = _savedLocations?[key];
            final name = data is Map ? data['name'] : null;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Icon(loc['icon'] as IconData, color: loc['color'] as Color, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(key[0].toUpperCase() + key.substring(1),
                            style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 13)),
                        Text(name ?? 'Not set',
                            style: GoogleFonts.inter(fontSize: 12, color: name != null ? Colors.grey[600] : Colors.grey[400]),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildRideHistoryCard(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Ride History', style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 16)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFF22C55E).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text('${_rideHistory.length}', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600, color: const Color(0xFF22C55E))),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_rideHistory.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text('No rides yet', style: GoogleFonts.inter(color: Colors.grey[400])),
              ),
            )
          else
            ...List.generate(_rideHistory.length.clamp(0, 5), (i) {
              final ride = _rideHistory[i];
              final fare = ride['fare']?.toString() ?? '—';
              final pickup = ride['pickupName']?.toString() ?? 'Unknown';
              final drop = ride['dropName']?.toString() ?? 'Unknown';
              final pts = ride['greenPointsAwarded']?.toString();

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF22C55E).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.directions_car_rounded, size: 18, color: Color(0xFF22C55E)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('$pickup → $drop',
                              style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w500),
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          Row(
                            children: [
                              Text('₹$fare', style: GoogleFonts.inter(fontSize: 12, color: Colors.grey[600])),
                              if (pts != null) ...[
                                const SizedBox(width: 8),
                                Text('🌱 +$pts pts', style: GoogleFonts.inter(fontSize: 11, color: const Color(0xFF22C55E))),
                              ],
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildLogoutButton() {
    return GestureDetector(
      onTap: _handleLogout,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: Colors.red.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.red.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.logout_rounded, color: Colors.red, size: 20),
            const SizedBox(width: 8),
            Text('Log Out', style: GoogleFonts.inter(color: Colors.red, fontWeight: FontWeight.w600, fontSize: 15)),
          ],
        ),
      ),
    );
  }
}
