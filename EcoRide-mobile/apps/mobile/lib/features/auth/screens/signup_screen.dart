/// Sign Up Screen
/// Premium Sign Up UI with glassmorphism and role selection for Eco-Ride.
library;

import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../../../main.dart' show isFirebaseInitialized;
import '../widgets/auth_text_field.dart';

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  UserRole _selectedRole = UserRole.rider;
  bool _isLoading = false;
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
    );
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.2),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOutCubic),
    );
    _animationController.forward();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _animationController.dispose();
    super.dispose();
  }

  Future<void> _handleSignUp() async {
    if (!_formKey.currentState!.validate()) return;

    if (!isFirebaseInitialized) {
      _showSnackbar('Demo Mode: Firebase not configured.', icon: Icons.info_outline, color: AppColors.primary);
      return;
    }

    setState(() => _isLoading = true);

    try {
      await AuthService.instance.signUp(
        email: _emailController.text,
        password: _passwordController.text,
        name: _nameController.text,
        phoneNumber: _phoneController.text,
        role: _selectedRole,
      );

      if (mounted) {
        _showSnackbar('Account created!', icon: Icons.check_circle_outline, color: AppColors.success);
        Navigator.of(context).pop();
      }
    } on AuthException catch (e) {
      if (e.code == 'email-already-in-use') {
        try {
          await AuthService.instance.signIn(
            email: _emailController.text,
            password: _passwordController.text,
          );

          final user = AuthService.instance.currentUser;
          if (user != null) {
            final profile = await AuthService.instance.getUserData(user.uid);
            if (profile != null && profile.role != _selectedRole) {
              await AuthService.instance.updateUserRole(user.uid, _selectedRole);
              if (mounted) _showSnackbar('Welcome! Role updated to ${_selectedRole.displayName}.', icon: Icons.info_outline, color: AppColors.primary);
            } else {
              if (mounted) _showSnackbar('Welcome back!', icon: Icons.info_outline, color: AppColors.primary);
            }
          }
          return;
        } catch (signInError) {
          if (mounted) _showSnackbar('Account exists. Please sign in.', icon: Icons.error_outline, color: AppColors.error);
          return;
        }
      }

      if (mounted) _showSnackbar(e.message, icon: Icons.error_outline, color: AppColors.error);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showSnackbar(String message, {required IconData icon, required Color color}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(icon, color: Colors.white, size: 20),
            const SizedBox(width: 12),
            Expanded(child: Text(message, style: GoogleFonts.inter(fontWeight: FontWeight.w500))),
          ],
        ),
        backgroundColor: color,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        margin: const EdgeInsets.all(16),
      ),
    );
  }

  String? _validateName(String? value) {
    if (value == null || value.isEmpty) return AppStrings.nameRequired;
    return null;
  }

  String? _validateEmail(String? value) {
    if (value == null || value.isEmpty) return AppStrings.emailRequired;
    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
    if (!emailRegex.hasMatch(value)) return AppStrings.invalidEmail;
    return null;
  }

  String? _validatePhone(String? value) {
    if (value == null || value.isEmpty) return AppStrings.phoneRequired;
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return AppStrings.passwordRequired;
    if (value.length < 6) return AppStrings.passwordTooShort;
    return null;
  }

  String? _validateConfirmPassword(String? value) {
    if (value == null || value.isEmpty) return AppStrings.passwordRequired;
    if (value != _passwordController.text) return AppStrings.passwordsDoNotMatch;
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Gradient background
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topRight,
                end: Alignment.bottomLeft,
                colors: [
                  Color(0xFFF0FDF4),
                  Color(0xFFECFDF5),
                  AppColors.background,
                ],
              ),
            ),
          ),

          // Decorative circles
          Positioned(
            top: -60,
            left: -40,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  colors: [
                    AppColors.secondary.withValues(alpha: 0.12),
                    AppColors.teal.withValues(alpha: 0.06),
                  ],
                ),
              ),
            ),
          ),

          SafeArea(
            child: Column(
              children: [
                // Back button
                Align(
                  alignment: Alignment.topLeft,
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: IconButton(
                      icon: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: AppColors.white.withValues(alpha: 0.8),
                          borderRadius: BorderRadius.circular(12),
                          boxShadow: AppShadows.soft,
                        ),
                        child: const Icon(Icons.arrow_back_ios_new, size: 18, color: AppColors.textPrimary),
                      ),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ),
                ),

                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: FadeTransition(
                      opacity: _fadeAnimation,
                      child: SlideTransition(
                        position: _slideAnimation,
                        child: Form(
                          key: _formKey,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _buildHeader(),
                              const SizedBox(height: 28),
                              _buildGlassCard(),
                              const SizedBox(height: 24),
                              _buildLoginLink(),
                              const SizedBox(height: 32),
                            ],
                          ),
                        ),
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

  Widget _buildHeader() {
    return Column(
      children: [
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            gradient: AppGradients.primaryButton,
            borderRadius: BorderRadius.circular(20),
            boxShadow: AppShadows.glow,
          ),
          child: const Icon(Icons.person_add_rounded, size: 36, color: AppColors.white),
        ),
        const SizedBox(height: 16),
        Text(
          AppStrings.createAccount,
          style: GoogleFonts.inter(
            fontSize: 26,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Join the green ride revolution',
          style: GoogleFonts.inter(fontSize: 14, color: AppColors.textSecondary),
        ),
      ],
    );
  }

  Widget _buildGlassCard() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.white.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: AppColors.lightGrey.withValues(alpha: 0.4)),
            boxShadow: AppShadows.card,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Role selector
              Text(
                'I want to',
                style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  _buildRoleChip(UserRole.rider, 'Ride'),
                  const SizedBox(width: 12),
                  _buildRoleChip(UserRole.driver, 'Drive'),
                ],
              ),
              const SizedBox(height: 24),

              // Form fields
              AuthTextField(
                controller: _nameController,
                label: AppStrings.fullName,
                prefixIcon: Icons.person_outline,
                validator: _validateName,
                textInputAction: TextInputAction.next,
                enabled: !_isLoading,
              ),
              const SizedBox(height: 14),
              AuthTextField(
                controller: _emailController,
                label: AppStrings.email,
                prefixIcon: Icons.email_outlined,
                isEmail: true,
                validator: _validateEmail,
                textInputAction: TextInputAction.next,
                enabled: !_isLoading,
              ),
              const SizedBox(height: 14),
              AuthTextField(
                controller: _phoneController,
                label: AppStrings.phoneNumber,
                prefixIcon: Icons.phone_outlined,
                isPhone: true,
                validator: _validatePhone,
                textInputAction: TextInputAction.next,
                enabled: !_isLoading,
              ),
              const SizedBox(height: 14),
              AuthTextField(
                controller: _passwordController,
                label: AppStrings.password,
                prefixIcon: Icons.lock_outlined,
                isPassword: true,
                validator: _validatePassword,
                textInputAction: TextInputAction.next,
                enabled: !_isLoading,
              ),
              const SizedBox(height: 14),
              AuthTextField(
                controller: _confirmPasswordController,
                label: AppStrings.confirmPassword,
                prefixIcon: Icons.lock_outlined,
                isPassword: true,
                validator: _validateConfirmPassword,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _handleSignUp(),
                enabled: !_isLoading,
              ),
              const SizedBox(height: 24),

              // Gradient Sign Up Button
              Container(
                height: 56,
                decoration: BoxDecoration(
                  gradient: _isLoading ? null : AppGradients.primaryButton,
                  color: _isLoading ? AppColors.grey : null,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: _isLoading ? [] : AppShadows.glow,
                ),
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: _isLoading ? null : _handleSignUp,
                    borderRadius: BorderRadius.circular(16),
                    child: Center(
                      child: _isLoading
                          ? const SizedBox(
                              height: 24,
                              width: 24,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                valueColor: AlwaysStoppedAnimation<Color>(AppColors.white),
                              ),
                            )
                          : Text(
                              AppStrings.signUp,
                              style: GoogleFonts.inter(
                                fontSize: 16, fontWeight: FontWeight.w700,
                                color: AppColors.white, letterSpacing: 0.5,
                              ),
                            ),
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

  Widget _buildRoleChip(UserRole role, String label) {
    final isSelected = _selectedRole == role;
    return Expanded(
      child: GestureDetector(
        onTap: _isLoading ? null : () => setState(() => _selectedRole = role),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            gradient: isSelected ? AppGradients.primaryButton : null,
            color: isSelected ? null : AppColors.offWhite,
            borderRadius: BorderRadius.circular(14),
            border: isSelected ? null : Border.all(color: AppColors.lightGrey),
            boxShadow: isSelected ? AppShadows.soft : [],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                role == UserRole.rider ? Icons.person : Icons.drive_eta,
                size: 18,
                color: isSelected ? AppColors.white : AppColors.textSecondary,
              ),
              const SizedBox(width: 8),
              Text(
                label,
                style: GoogleFonts.inter(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: isSelected ? AppColors.white : AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLoginLink() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          AppStrings.haveAccount,
          style: GoogleFonts.inter(fontSize: 14, color: AppColors.textSecondary),
        ),
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.of(context).pop(),
          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 4)),
          child: Text(
            AppStrings.signIn,
            style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.primary),
          ),
        ),
      ],
    );
  }
}
