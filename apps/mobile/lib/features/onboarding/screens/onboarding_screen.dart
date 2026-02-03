import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../auth/screens/login_screen.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _formKey = GlobalKey<FormState>();

  // State
  bool _isLoading = false;
  UserRole _selectedRole = UserRole.rider;

  // Controllers
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  
  // Driver Fields
  final _plateNumberController = TextEditingController();
  final _modelController = TextEditingController();
  final _pollutionExpiryController = TextEditingController();
  bool _isEv = false;

  // Files
  File? _kycFile;
  File? _licenseFile;
  String? _kycFileName;
  String? _licenseFileName;

  @override
  void initState() {
    super.initState();
    _prefillData();
  }

  Future<void> _prefillData() async {
    final user = await AuthService.instance.currentUser;
    if (user != null) {
      if (user.displayName != null && _nameController.text.isEmpty) {
        setState(() {
          _nameController.text = user.displayName!;
        });
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _plateNumberController.dispose();
    _modelController.dispose();
    _pollutionExpiryController.dispose();
    super.dispose();
  }

  // File Picker
  Future<void> _pickFile(bool isKyc) async {
    try {
      final result = await FilePicker.platform.pickFiles(
         type: FileType.custom,
         allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'],
      );

      if (result != null && result.files.single.path != null) {
        setState(() {
          if (isKyc) {
            _kycFile = File(result.files.single.path!);
            _kycFileName = result.files.single.name;
          } else {
            _licenseFile = File(result.files.single.path!);
            _licenseFileName = result.files.single.name;
          }
        });
      }
    } catch (e) {
      _showErrorSnackbar('Error picking file: $e');
    }
  }

  // Date Picker
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
      if (_licenseFile == null) {
        _showErrorSnackbar('Driver License is required');
        return;
      }
      if (_plateNumberController.text.isEmpty || _modelController.text.isEmpty || _pollutionExpiryController.text.isEmpty) {
         _showErrorSnackbar('All vehicle details are required');
         return;
      }
    }

    setState(() => _isLoading = true);

    try {
      final user = AuthService.instance.currentUser;
      if (user == null) throw const AuthException('User session expired');

      String? kycUrl;
      String? licenseUrl;

      // Upload Files
      if (_selectedRole == UserRole.driver) {
         if (_kycFile != null) {
            kycUrl = await AuthService.instance.uploadFile(
               _kycFile!,
               'drivers/${user.uid}/kyc/${DateTime.now().millisecondsSinceEpoch}_$_kycFileName'
            );
         }
         if (_licenseFile != null) {
            licenseUrl = await AuthService.instance.uploadFile(
               _licenseFile!,
               'drivers/${user.uid}/license/${DateTime.now().millisecondsSinceEpoch}_$_licenseFileName'
            );
         }
      }

      await AuthService.instance.createBackendProfile(
        name: _nameController.text.trim(),
        phoneNumber: _phoneController.text.trim(),
        role: _selectedRole,
        kycUrl: kycUrl,
        licenseUrl: licenseUrl,
        plateNumber: _plateNumberController.text.trim().toUpperCase(),
        model: _modelController.text.trim(),
        isEv: _isEv,
        pollutionExpiry: _pollutionExpiryController.text,
      );

      // Sign out immediately
       await AuthService.instance.signOut();

      if (mounted) {
         _showSuccessSnackbar('Profile Completed! Please sign in.');
         // Navigate to Login Screen (clearing stack works best if we came from AuthGate)
         // But since AuthGate catches the signOut, it will rebuild to Login Screen automatically.
         // However, in some cases it's better to be explicit if we are inside a navigator.
         // For OnboardingScreen which is shown by AuthGate, signOut will trigger rebuild.
      }
    } catch (e) {
      if (mounted) {
        _showErrorSnackbar(e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _showErrorSnackbar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red.shade700,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

   void _showSuccessSnackbar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.primary,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 20),
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.person, size: 32, color: Colors.white),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  'Complete Your Profile',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.poppins(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Just a few more details to get you started',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 32),

                // Name
                TextFormField(
                  controller: _nameController,
                  decoration: _inputDecoration('Full Name', Icons.person_outline),
                  validator: (v) => v?.isEmpty ?? true ? 'Name is required' : null,
                ),
                const SizedBox(height: 16),

                // Phone
                TextFormField(
                  controller: _phoneController,
                  decoration: _inputDecoration('Phone Number', Icons.phone_outlined),
                  keyboardType: TextInputType.phone,
                  validator: (v) => v?.isEmpty ?? true ? 'Phone is required' : null,
                ),
                const SizedBox(height: 24),

                // Role Selection
                Text('I want to join as', style: GoogleFonts.poppins(fontWeight: FontWeight.w500)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _buildRoleButton(UserRole.rider, 'Rider', Icons.person_outline)),
                    const SizedBox(width: 12),
                    Expanded(child: _buildRoleButton(UserRole.driver, 'Driver', Icons.drive_eta_outlined)),
                  ],
                ),
                const SizedBox(height: 24),

                // Driver Fields
                if (_selectedRole == UserRole.driver) _buildDriverFields(),

                const SizedBox(height: 32),

                // Submit Button
                ElevatedButton(
                  onPressed: _isLoading ? null : _handleSubmit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 0,
                  ),
                  child: _isLoading 
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : Text(
                        'Complete Registration',
                        style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRoleButton(UserRole role, String label, IconData icon) {
    final isSelected = _selectedRole == role;
    return InkWell(
      onTap: () => setState(() => _selectedRole = role),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : Colors.white,
          border: Border.all(color: isSelected ? AppColors.primary : AppColors.lightGrey),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: isSelected ? Colors.white : AppColors.textPrimary, size: 20),
            const SizedBox(width: 8),
            Text(
              label,
              style: GoogleFonts.poppins(
                fontWeight: FontWeight.w600,
                color: isSelected ? Colors.white : AppColors.textPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDriverFields() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F8E9), // Light green bg
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Driver Information',
            style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.primary),
          ),
          const SizedBox(height: 16),
          
          // KYC Upload
          _buildFileUpload('KYC Document', _kycFileName, () => _pickFile(true)),
          const SizedBox(height: 16),
          
          // License Upload
          _buildFileUpload('Driver License *', _licenseFileName, () => _pickFile(false)),
          const SizedBox(height: 16),

          // Plate Number
          TextFormField(
            controller: _plateNumberController,
            decoration: _inputDecoration('Plate Number *', Icons.directions_car_outlined),
            textCapitalization: TextCapitalization.characters,
            validator: (v) => _selectedRole == UserRole.driver && (v?.isEmpty ?? true) ? 'Required' : null,
          ),
          const SizedBox(height: 16),

          // Model
          TextFormField(
            controller: _modelController,
            decoration: _inputDecoration('Vehicle Model *', Icons.commute_outlined),
            validator: (v) => _selectedRole == UserRole.driver && (v?.isEmpty ?? true) ? 'Required' : null,
          ),
          const SizedBox(height: 16),

          // EV Checkbox
          CheckboxListTile(
            value: _isEv,
            onChanged: (v) => setState(() => _isEv = v ?? false),
            title: Text('This is an Electric Vehicle (EV)', style: GoogleFonts.poppins(fontSize: 14)),
            activeColor: AppColors.primary,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          
          // Pollution Expiry
          InkWell(
            onTap: _pickDate,
            child: IgnorePointer(
              child: TextFormField(
                controller: _pollutionExpiryController,
                decoration: _inputDecoration('Pollution Certificate Expiry *', Icons.calendar_today),
                validator: (v) => _selectedRole == UserRole.driver && (v?.isEmpty ?? true) ? 'Required' : null,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFileUpload(String label, String? fileName, VoidCallback onTap) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.primary.withOpacity(0.5), style: BorderStyle.solid),
              borderRadius: BorderRadius.circular(12),
              color: Colors.white,
            ),
            child: Row(
              children: [
                Icon(Icons.upload_file, color: AppColors.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    fileName ?? 'Tap to upload file',
                    style: GoogleFonts.poppins(
                      color: fileName != null ? AppColors.textPrimary : AppColors.textSecondary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (fileName != null) const Icon(Icons.check_circle, color: AppColors.primary, size: 18),
              ],
            ),
          ),
        ),
      ],
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, color: AppColors.primary, size: 20),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.lightGrey),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.lightGrey),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.primary, width: 2),
      ),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.all(16),
    );
  }
}
