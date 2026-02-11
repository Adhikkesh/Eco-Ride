import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;
  UserRole _selectedRole = UserRole.rider;

  // Controllers
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  
  // Driver Fields
  final _plateNumberController = TextEditingController();
  final _modelController = TextEditingController();
  final _pollutionExpiryController = TextEditingController();
  final _passengersController = TextEditingController();
  bool _isEv = false;

  // Files
  Uint8List? _kycBytes;
  Uint8List? _licenseBytes;
  String? _kycFileName;
  String? _licenseFileName;

  // Design Colors
  static const Color sageGreen = Color(0xFFC8E6C9);
  static const Color ecoGreen = Color(0xFF4CAF50);

  @override
  void initState() {
    super.initState();
    _prefillData();
  }

  Future<void> _prefillData() async {
    final user = AuthService.instance.currentUser;
    if (user != null) {
      setState(() {
        _nameController.text = user.displayName ?? '';
      });
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _plateNumberController.dispose();
    _modelController.dispose();
    _pollutionExpiryController.dispose();
    _passengersController.dispose();
    super.dispose();
  }

  Future<void> _pickFile(bool isKyc) async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'],
        withData: kIsWeb, // Required for bytes on some platforms
      );

      if (result != null && result.files.single.bytes != null) {
        setState(() {
          if (isKyc) {
            _kycBytes = result.files.single.bytes;
            _kycFileName = result.files.single.name;
          } else {
            _licenseBytes = result.files.single.bytes;
            _licenseFileName = result.files.single.name;
          }
        });
      } else if (result != null && result.files.single.path != null) {
        // Fallback for mobile if needed
        final file = File(result.files.single.path!);
        final bytes = await file.readAsBytes();
        setState(() {
          if (isKyc) {
            _kycBytes = bytes;
            _kycFileName = result.files.single.name;
          } else {
            _licenseBytes = bytes;
            _licenseFileName = result.files.single.name;
          }
        });
      }
    } catch (e) {
      debugPrint('Onboarding: File pick error: $e');
      _showErrorSnackBar('Error picking file: $e');
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 365)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 10)),
    );
    if (picked != null) {
      setState(() {
        _pollutionExpiryController.text = DateFormat('yyyy-MM-dd').format(picked);
      });
    }
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    if (_selectedRole == UserRole.driver) {
      if (_licenseBytes == null) {
        _showErrorSnackBar('Driver License is required');
        return;
      }
    }

    setState(() => _isLoading = true);

    try {
      final user = AuthService.instance.currentUser;
      if (user == null) throw const AuthException('User not authenticated');

      String? kycUrl;
      String? licenseUrl;

      // Upload Files if Driver
      if (_selectedRole == UserRole.driver) {
        if (_kycBytes != null) {
          kycUrl = await AuthService.instance.uploadBytes(
            _kycBytes!,
            'drivers/${user.uid}/kyc/${DateTime.now().millisecondsSinceEpoch}_$_kycFileName',
          );
        }
        if (_licenseBytes != null) {
          licenseUrl = await AuthService.instance.uploadBytes(
            _licenseBytes!,
            'drivers/${user.uid}/license/${DateTime.now().millisecondsSinceEpoch}_$_licenseFileName',
          );
        }
      }

      await AuthService.instance.createBackendProfile(
        name: _nameController.text.trim(),
        phoneNumber: _phoneController.text.trim(),
        role: _selectedRole,
        kycUrl: kycUrl ?? 'completed',
        licenseUrl: licenseUrl ?? 'completed',
        plateNumber: _plateNumberController.text.trim().toUpperCase(),
        vehicleModel: _modelController.text.trim(),
        isEv: _isEv,
        pollutionExpiry: _pollutionExpiryController.text,
        passengerCapacity: int.tryParse(_passengersController.text.trim()),
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile Completed! Welcome to Eco-Ride.')),
        );
      }
    } catch (e) {
      if (mounted) _showErrorSnackBar(e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showErrorSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: sageGreen,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _buildMainCard(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMainCard() {
    return Container(
      constraints: const BoxConstraints(maxWidth: 500),
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Form(
        key: _formKey,
        child: Column(
          children: [
            // Icon
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF2E7D32),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.directions_car, color: Colors.white, size: 32),
            ),
            const SizedBox(height: 16),
            
            // Title
            Text(
              'Complete Your Profile',
              style: GoogleFonts.poppins(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF212121),
              ),
            ),
            Text(
              'Just a few more details to get you started',
              style: GoogleFonts.poppins(
                fontSize: 14,
                color: Colors.grey[600],
              ),
            ),
            const SizedBox(height: 32),

            // Basic Fields
            _buildTextField(_nameController, 'Full Name', Icons.person_outline),
            const SizedBox(height: 16),
            _buildTextField(_phoneController, 'Phone Number', Icons.phone_outlined, keyboardType: TextInputType.phone),
            const SizedBox(height: 24),

            // Role Selector
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'I want to join as',
                style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 14),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _buildRoleChip(UserRole.rider, '🏃 Rider')),
                const SizedBox(width: 12),
                Expanded(child: _buildRoleChip(UserRole.driver, '🚗 Driver')),
              ],
            ),
            const SizedBox(height: 24),

            // Driver Specific Fields
            if (_selectedRole == UserRole.driver) ...[
              _buildDriverInformation(),
              const SizedBox(height: 24),
            ],

            // Submit Button
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleSubmit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: ecoGreen,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
                child: _isLoading 
                  ? const CircularProgressIndicator(color: Colors.white)
                  : Text('Complete Registration', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRoleChip(UserRole role, String label) {
    final isSelected = _selectedRole == role;
    return GestureDetector(
      onTap: () => setState(() => _selectedRole = role),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isSelected ? ecoGreen : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? ecoGreen : Colors.grey[300]!),
        ),
        child: Text(
          label,
          style: GoogleFonts.poppins(
            fontWeight: FontWeight.bold,
            color: isSelected ? Colors.white : Colors.black87,
          ),
        ),
      ),
    );
  }

  Widget _buildDriverInformation() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FBE7),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.lime[100]!),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Driver Information',
            style: GoogleFonts.poppins(fontWeight: FontWeight.bold, color: const Color(0xFF689F38)),
          ),
          const SizedBox(height: 16),
          _buildFileUpload('KYC Document (PDF,JPEG)', _kycFileName, () => _pickFile(true)),
          const SizedBox(height: 12),
          _buildFileUpload('Driver License (PDF,JPEG) *', _licenseFileName, () => _pickFile(false)),
          const SizedBox(height: 16),
          _buildTextField(_plateNumberController, 'Plate Number *', Icons.pin_outlined),
          const SizedBox(height: 12),
          _buildTextField(_modelController, 'Vehicle Model *', Icons.directions_car_outlined),
          const SizedBox(height: 12),
          Row(
            children: [
              Transform.scale(
                scale: 0.9,
                child: Checkbox(
                  value: _isEv,
                  onChanged: (v) => setState(() => _isEv = v ?? false),
                  activeColor: ecoGreen,
                ),
              ),
              Text('This is an Electric Vehicle (EV)', style: GoogleFonts.poppins(fontSize: 13)),
            ],
          ),
          const SizedBox(height: 8),
          const SizedBox(height: 12),
          _buildTextField(_passengersController, 'Number of Passengers *', Icons.groups_outlined, keyboardType: TextInputType.number),
          const SizedBox(height: 8),
          _buildDateField(_pollutionExpiryController, 'Pollution Certificate Expiry *', _pickDate),
        ],
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, String label, IconData icon, {TextInputType? keyboardType}) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, size: 20),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      validator: (v) => v?.isEmpty ?? true ? 'Required' : null,
    );
  }

  Widget _buildDateField(TextEditingController controller, String label, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      child: IgnorePointer(
        child: TextFormField(
          controller: controller,
          decoration: InputDecoration(
            labelText: label,
            prefixIcon: const Icon(Icons.calendar_today, size: 20),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ),
    );
  }

  Widget _buildFileUpload(String label, String? fileName, VoidCallback onTap) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w500)),
        const SizedBox(height: 6),
        InkWell(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey[300]!, style: BorderStyle.none),
              borderRadius: BorderRadius.circular(12),
              color: Colors.white,
            ),
            child: Row(
              children: [
                OutlinedButton(
                  onPressed: onTap,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(60, 30),
                  ),
                  child: const Text('Choose file', style: TextStyle(fontSize: 10)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    fileName ?? 'No file chosen',
                    style: const TextStyle(fontSize: 12, color: Colors.grey),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
