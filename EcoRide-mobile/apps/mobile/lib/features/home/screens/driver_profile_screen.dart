import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../auth/screens/login_screen.dart';

class DriverProfileScreen extends StatefulWidget {
  final bool isDarkMode;
  const DriverProfileScreen({super.key, required this.isDarkMode});

  @override
  State<DriverProfileScreen> createState() => _DriverProfileScreenState();
}

class _DriverProfileScreenState extends State<DriverProfileScreen> {
  bool _isLoading = true;
  bool _isEditing = false;
  bool _isSaving = false;

  // Personal Info
  String _displayName = '';
  String _phoneNumber = '';
  String _email = '';
  String? _photoURL;

  // Driver Stats
  double _rating = 0;
  double _totalEarnings = 0;

  // Vehicle Details
  String? _vehicleModel;
  String? _vehiclePlate;

  // KYC
  bool _kycVerified = false;
  String? _kycUrl;
  String? _licenseUrl;

  // Driving History
  List<Map<String, dynamic>> _rideHistory = [];
  bool _loadingHistory = false;

  // Edit controllers
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadProfileData();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadProfileData() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    setState(() => _isLoading = true);

    try {
      // 1. Personal Info from users collection
      final userDoc = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get();

      if (userDoc.exists) {
        final data = userDoc.data()!;
        _displayName = data['displayName']?.toString() ??
            data['name']?.toString() ??
            user.displayName ?? 'Driver';
        _phoneNumber = data['phoneNumber']?.toString() ??
            data['phone_number']?.toString() ?? '';
        _email = data['email']?.toString() ?? user.email ?? '';
        _photoURL = data['photoURL']?.toString() ?? user.photoURL;
      }

      // 2. Vehicle Details from vehicle collection
      final vehicleQuery = await FirebaseFirestore.instance
          .collection('vehicle')
          .where('driver_uid', isEqualTo: user.uid)
          .limit(1)
          .get();

      if (vehicleQuery.docs.isNotEmpty) {
        final vData = vehicleQuery.docs.first.data();
        _vehicleModel = vData['model']?.toString() ?? 'Unknown';
        _vehiclePlate = vData['plate_number']?.toString() ?? 'Unknown';
      }

      // 3. Driver Profile (KYC) from driver_profile collection
      final profileDoc = await FirebaseFirestore.instance
          .collection('driver_profile')
          .doc(user.uid)
          .get();

      if (profileDoc.exists) {
        final pData = profileDoc.data()!;
        _kycVerified = pData['kyc_verified'] == true;
        _kycUrl = pData['kyc_url']?.toString();
        _licenseUrl = pData['license_url']?.toString();
      }

      // 4. Calculate total earnings from rides
      final ridesSnapshot = await FirebaseFirestore.instance
          .collection('rides')
          .where('driverId', isEqualTo: user.uid)
          .get();

      double total = 0;
      for (final doc in ridesSnapshot.docs) {
        total += (doc.data()['fare'] as num?)?.toDouble() ?? 0;
      }
      _totalEarnings = total;

      // 5. Calculate average rating from ratings collection
      final ratingsSnapshot = await FirebaseFirestore.instance
          .collection('ratings')
          .where('driverId', isEqualTo: user.uid)
          .get();

      if (ratingsSnapshot.docs.isNotEmpty) {
        double sum = 0;
        for (final doc in ratingsSnapshot.docs) {
          sum += (doc.data()['rating'] as num?)?.toDouble() ?? 0;
        }
        _rating = sum / ratingsSnapshot.docs.length;
      }

      // 6. Load ride history
      _loadingHistory = true;
      final historyDocs = ridesSnapshot.docs.map((doc) {
        final data = doc.data();
        return {
          'id': doc.id,
          ...data,
        };
      }).toList();

      // Sort by timestamp descending
      historyDocs.sort((a, b) {
        int getSeconds(dynamic val) {
          if (val is Timestamp) return val.seconds;
          return 0;
        }
        final aTime = getSeconds(a['timestamp']) != 0
            ? getSeconds(a['timestamp'])
            : getSeconds(a['createdAt']);
        final bTime = getSeconds(b['timestamp']) != 0
            ? getSeconds(b['timestamp'])
            : getSeconds(b['createdAt']);
        return bTime.compareTo(aTime);
      });

      _rideHistory = historyDocs.take(20).toList();
      _loadingHistory = false;

      // Set edit controllers
      _nameController.text = _displayName;
      _phoneController.text = _phoneNumber;

    } catch (e) {
      debugPrint('DriverProfile: Error loading data: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handleSave() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    setState(() => _isSaving = true);

    try {
      final newName = _nameController.text.trim();
      final newPhone = _phoneController.text.trim();

      // Update Firestore
      await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .update({
        'displayName': newName,
        'phoneNumber': newPhone,
      });

      // Update Firebase Auth display name
      await user.updateDisplayName(newName);

      setState(() {
        _displayName = newName;
        _phoneNumber = newPhone;
        _isEditing = false;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Profile updated successfully!'),
            backgroundColor: Color(0xFF2E7D32),
          ),
        );
      }
    } catch (e) {
      debugPrint('DriverProfile: Error saving: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error saving profile: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _handlePhotoUpload() async {
    // Photo upload requires image_picker package
    // For now, show a message
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Photo upload coming soon!'),
          backgroundColor: Color(0xFF2E7D32),
        ),
      );
    }
  }

  Future<void> _handleLogout() async {
    await AuthService.instance.signOut();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = widget.isDarkMode;
    final bgColor = isDark ? const Color(0xFF0F172A) : Colors.grey[100]!;
    final cardBg = isDark ? const Color(0xFF1E293B) : Colors.white;
    final textColor = isDark ? Colors.white : Colors.black87;
    final subtextColor = isDark ? Colors.white60 : Colors.grey[600]!;
    final borderColor = isDark ? Colors.white12 : Colors.grey[200]!;

    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: cardBg,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, color: textColor),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Profile',
          style: GoogleFonts.inter(
            color: textColor,
            fontWeight: FontWeight.w700,
            fontSize: 20,
          ),
        ),
        centerTitle: false,
        actions: [
          if (!_isEditing)
            TextButton.icon(
              onPressed: () => setState(() => _isEditing = true),
              icon: Icon(Icons.edit_rounded, color: AppColors.primary, size: 18),
              label: Text('Edit', style: GoogleFonts.inter(color: AppColors.primary, fontWeight: FontWeight.w600)),
            ),
        ],
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // Profile Photo
                  _buildProfilePhoto(isDark, cardBg),
                  const SizedBox(height: 24),

                  // Personal Info Section
                  _buildSectionCard(
                    isDark, cardBg, textColor, subtextColor, borderColor,
                    title: 'Personal Information',
                    titleColor: AppColors.primary,
                    children: [
                      _buildInfoRow(Icons.person_rounded, 'Full Name',
                          _isEditing ? null : _displayName,
                          isDark, textColor, subtextColor,
                          editWidget: _isEditing ? _buildEditField(_nameController, isDark, textColor) : null),
                      const SizedBox(height: 16),
                      _buildInfoRow(Icons.phone_rounded, 'Phone Number',
                          _isEditing ? null : _phoneNumber,
                          isDark, textColor, subtextColor,
                          editWidget: _isEditing ? _buildEditField(_phoneController, isDark, textColor) : null),
                      const SizedBox(height: 16),
                      _buildInfoRow(Icons.email_rounded, 'Email Address',
                          _email, isDark, textColor, subtextColor),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Rating & Earnings
                  Row(
                    children: [
                      Expanded(
                        child: _buildStatCard(
                          isDark, borderColor,
                          icon: Icons.star_rounded,
                          label: 'RATING',
                          value: _rating > 0 ? _rating.toStringAsFixed(1) : 'N/A',
                          sublabel: 'Average Rating',
                          gradientColors: [const Color(0xFF8B6914), const Color(0xFFD4A843)],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _buildStatCard(
                          isDark, borderColor,
                          icon: Icons.account_balance_wallet_rounded,
                          label: 'EARNINGS',
                          value: '₹${_totalEarnings.toStringAsFixed(0)}',
                          sublabel: 'Total Earnings',
                          gradientColors: [const Color(0xFF1B5E20), const Color(0xFF2E7D32)],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Vehicle Details
                  _buildSectionCard(
                    isDark, cardBg, textColor, subtextColor, borderColor,
                    title: 'Vehicle Details',
                    titleColor: AppColors.primary,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Icon(Icons.directions_car_rounded, color: AppColors.primary, size: 28),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _vehicleModel ?? 'No registered vehicle',
                                  style: GoogleFonts.inter(
                                    color: textColor,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 15,
                                  ),
                                ),
                                Text(
                                  _vehiclePlate ?? '---',
                                  style: GoogleFonts.inter(
                                    color: subtextColor,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Compliance & KYC
                  _buildSectionCard(
                    isDark, cardBg, textColor, subtextColor, borderColor,
                    title: 'Compliance & KYC',
                    titleColor: AppColors.primary,
                    children: [
                      Row(
                        children: [
                          Icon(
                            _kycVerified ? Icons.verified_rounded : Icons.pending_rounded,
                            color: _kycVerified ? AppColors.primary : Colors.orange,
                            size: 22,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'KYC Verification Status',
                            style: GoogleFonts.inter(color: textColor, fontWeight: FontWeight.w500, fontSize: 14),
                          ),
                          const Spacer(),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: _kycVerified
                                  ? AppColors.primary.withValues(alpha: 0.15)
                                  : Colors.orange.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              _kycVerified ? 'VERIFIED' : 'PENDING',
                              style: GoogleFonts.inter(
                                color: _kycVerified ? AppColors.primary : Colors.orange,
                                fontWeight: FontWeight.w700,
                                fontSize: 11,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: _buildDocButton(
                              Icons.description_rounded,
                              'KYC Document',
                              _kycUrl,
                              isDark, textColor, subtextColor,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _buildDocButton(
                              Icons.badge_rounded,
                              'Driver License',
                              _licenseUrl,
                              isDark, textColor, subtextColor,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Driving History
                  _buildSectionCard(
                    isDark, cardBg, textColor, subtextColor, borderColor,
                    title: 'Driving History',
                    titleIcon: Icons.history_rounded,
                    titleColor: textColor,
                    children: _loadingHistory
                        ? [const Center(child: CircularProgressIndicator())]
                        : _rideHistory.isEmpty
                            ? [Text('No ride history yet', style: GoogleFonts.inter(color: subtextColor))]
                            : _rideHistory.map((ride) => _buildRideHistoryItem(ride, isDark, textColor, subtextColor, borderColor)).toList(),
                  ),
                  const SizedBox(height: 16),

                  // Edit Profile / Save buttons
                  if (_isEditing) ...[
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () {
                              setState(() {
                                _isEditing = false;
                                _nameController.text = _displayName;
                                _phoneController.text = _phoneNumber;
                              });
                            },
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              side: BorderSide(color: isDark ? Colors.white24 : Colors.grey[400]!),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                            child: Text('Cancel', style: GoogleFonts.inter(color: subtextColor, fontWeight: FontWeight.w600)),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 2,
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              gradient: const LinearGradient(colors: [Color(0xFF2E7D32), Color(0xFF43A047)]),
                            ),
                            child: ElevatedButton(
                              onPressed: _isSaving ? null : _handleSave,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.transparent,
                                shadowColor: Colors.transparent,
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                              child: _isSaving
                                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                                  : Text('Save Changes', style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.w700)),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Logout Button
                  OutlinedButton.icon(
                    onPressed: _handleLogout,
                    icon: Icon(Icons.logout_rounded, color: Colors.red[400], size: 18),
                    label: Text('Logout', style: GoogleFonts.inter(color: Colors.red[400], fontWeight: FontWeight.w600)),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 32),
                      side: BorderSide(color: Colors.red[400]!),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                  const SizedBox(height: 40),
                ],
              ),
            ),
    );
  }

  // ════════════════════════════════════════════════
  // HELPER WIDGETS
  // ════════════════════════════════════════════════

  Widget _buildProfilePhoto(bool isDark, Color cardBg) {
    return Center(
      child: GestureDetector(
        onTap: _isEditing ? _handlePhotoUpload : null,
        child: Stack(
          children: [
            Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.primary, width: 3),
              ),
              child: _photoURL != null
                  ? ClipOval(child: Image.network(_photoURL!, fit: BoxFit.cover, width: 100, height: 100))
                  : CircleAvatar(
                      radius: 48,
                      backgroundColor: isDark ? const Color(0xFF1E293B) : Colors.grey[200],
                      child: Icon(Icons.person_rounded, color: AppColors.primary, size: 48),
                    ),
            ),
            if (_isEditing)
              Positioned(
                bottom: 0, right: 0,
                child: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                    border: Border.all(color: cardBg, width: 2),
                  ),
                  child: const Icon(Icons.camera_alt_rounded, color: Colors.white, size: 16),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionCard(
    bool isDark, Color cardBg, Color textColor, Color subtextColor, Color borderColor, {
    required String title,
    Color? titleColor,
    IconData? titleIcon,
    required List<Widget> children,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (titleIcon != null) ...[
                Icon(titleIcon, color: titleColor ?? textColor, size: 20),
                const SizedBox(width: 8),
              ],
              Text(
                title,
                style: GoogleFonts.inter(
                  color: titleColor ?? textColor,
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }

  Widget _buildInfoRow(IconData icon, String label, String? value,
      bool isDark, Color textColor, Color subtextColor, {Widget? editWidget}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GoogleFonts.inter(color: subtextColor, fontSize: 12, fontWeight: FontWeight.w500)),
        const SizedBox(height: 6),
        Row(
          children: [
            Icon(icon, color: subtextColor, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: editWidget ?? Text(
                value ?? '---',
                style: GoogleFonts.inter(color: textColor, fontSize: 15, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildEditField(TextEditingController controller, bool isDark, Color textColor) {
    return TextField(
      controller: controller,
      style: GoogleFonts.inter(color: textColor, fontSize: 15),
      decoration: InputDecoration(
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        filled: true,
        fillColor: isDark ? const Color(0xFF0F172A) : Colors.grey[100],
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: isDark ? Colors.white24 : Colors.grey[300]!),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: isDark ? Colors.white24 : Colors.grey[300]!),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: AppColors.primary, width: 2),
        ),
      ),
    );
  }

  Widget _buildStatCard(
    bool isDark, Color borderColor, {
    required IconData icon,
    required String label,
    required String value,
    required String sublabel,
    required List<Color> gradientColors,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: Colors.white.withValues(alpha: 0.85), size: 18),
              const SizedBox(width: 6),
              Text(label, style: GoogleFonts.inter(color: Colors.white.withValues(alpha: 0.85), fontWeight: FontWeight.w700, fontSize: 11)),
            ],
          ),
          const SizedBox(height: 8),
          Text(value, style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 28)),
          Text(sublabel, style: GoogleFonts.inter(color: Colors.white.withValues(alpha: 0.65), fontSize: 11)),
        ],
      ),
    );
  }

  Widget _buildDocButton(IconData icon, String label, String? url,
      bool isDark, Color textColor, Color subtextColor) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF0F172A) : Colors.grey[100],
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: isDark ? Colors.white12 : Colors.grey[300]!),
      ),
      child: Row(
        children: [
          Icon(icon, color: subtextColor, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: GoogleFonts.inter(color: textColor, fontSize: 12, fontWeight: FontWeight.w500),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (url != null && url.isNotEmpty)
            Icon(Icons.open_in_new_rounded, color: AppColors.primary, size: 16),
        ],
      ),
    );
  }

  Widget _buildRideHistoryItem(Map<String, dynamic> ride, bool isDark,
      Color textColor, Color subtextColor, Color borderColor) {
    final pickupName = ride['pickupName']?.toString() ?? 'Pickup Location';
    final dropName = ride['dropName']?.toString() ?? 'Destination';
    final fare = ride['fare'];
    final status = ride['status']?.toString() ?? 'UNKNOWN';
    final duration = ride['duration']?.toString();
    final greenPts = ride['greenPointsAwarded'];
    final greenPtsNum = (greenPts is num) ? greenPts : null;

    // Format date
    String dateStr = '';
    final tsRaw = ride['timestamp'] ?? ride['createdAt'];
    if (tsRaw is Timestamp) {
      final date = tsRaw.toDate();
      dateStr = '${date.month}/${date.day}/${date.year}';
    }

    final isCompleted = status == 'COMPLETED';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF0F172A) : Colors.grey[50],
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Date + Status
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(Icons.calendar_today_rounded, color: subtextColor, size: 14),
                  const SizedBox(width: 6),
                  Text(dateStr, style: GoogleFonts.inter(color: subtextColor, fontSize: 12)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isCompleted
                      ? AppColors.primary.withValues(alpha: 0.15)
                      : Colors.orange.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  status,
                  style: GoogleFonts.inter(
                    color: isCompleted ? AppColors.primary : Colors.orange,
                    fontWeight: FontWeight.w700,
                    fontSize: 10,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Pickup
          Row(
            children: [
              Container(
                width: 8, height: 8,
                decoration: const BoxDecoration(color: Color(0xFF4CAF50), shape: BoxShape.circle),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(pickupName, style: GoogleFonts.inter(color: textColor, fontSize: 13, fontWeight: FontWeight.w500),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          const SizedBox(height: 6),
          // Drop
          Row(
            children: [
              Container(
                width: 8, height: 8,
                decoration: const BoxDecoration(color: Color(0xFFE53935), shape: BoxShape.circle),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(dropName, style: GoogleFonts.inter(color: textColor, fontSize: 13, fontWeight: FontWeight.w500),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Duration, Points, Fare
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  if (duration != null && duration.isNotEmpty) ...[
                    Icon(Icons.timer_outlined, color: subtextColor, size: 14),
                    const SizedBox(width: 4),
                    Text(duration, style: GoogleFonts.inter(color: subtextColor, fontSize: 12)),
                    const SizedBox(width: 12),
                  ],
                  if (greenPtsNum != null && greenPtsNum > 0) ...[
                    Icon(Icons.eco_rounded, color: AppColors.primary, size: 14),
                    const SizedBox(width: 4),
                    Text('+$greenPtsNum pts', style: GoogleFonts.inter(color: AppColors.primary, fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ],
              ),
              if (fare != null)
                Text('₹$fare', style: GoogleFonts.inter(color: textColor, fontSize: 16, fontWeight: FontWeight.w700)),
            ],
          ),
        ],
      ),
    );
  }
}
