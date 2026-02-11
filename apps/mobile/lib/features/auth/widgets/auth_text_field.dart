/// Reusable Authentication Text Field
/// Styled with Eco-Ride theme for consistent UI across auth screens.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/constants/app_constants.dart';

class AuthTextField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final IconData? prefixIcon;
  final bool isPassword;
  final bool isEmail;
  final bool isPhone;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;
  final bool enabled;
  final int maxLines;
  final List<TextInputFormatter>? inputFormatters;
  final void Function(String)? onChanged;
  final TextInputAction? textInputAction;
  final void Function(String)? onFieldSubmitted;

  const AuthTextField({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.prefixIcon,
    this.isPassword = false,
    this.isEmail = false,
    this.isPhone = false,
    this.keyboardType,
    this.validator,
    this.enabled = true,
    this.maxLines = 1,
    this.inputFormatters,
    this.onChanged,
    this.textInputAction,
    this.onFieldSubmitted,
  });

  @override
  State<AuthTextField> createState() => _AuthTextFieldState();
}

class _AuthTextFieldState extends State<AuthTextField> {
  bool _obscureText = true;
  bool _isFocused = false;

  TextInputType get _keyboardType {
    if (widget.keyboardType != null) return widget.keyboardType!;
    if (widget.isEmail) return TextInputType.emailAddress;
    if (widget.isPhone) return TextInputType.phone;
    return TextInputType.text;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      onFocusChange: (hasFocus) {
        setState(() => _isFocused = hasFocus);
      },
      child: TextFormField(
        controller: widget.controller,
        obscureText: widget.isPassword && _obscureText,
        keyboardType: _keyboardType,
        maxLines: widget.isPassword ? 1 : widget.maxLines,
        enabled: widget.enabled,
        inputFormatters: widget.inputFormatters,
        onChanged: widget.onChanged,
        textInputAction: widget.textInputAction,
        onFieldSubmitted: widget.onFieldSubmitted,
        style: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: 16,
          fontWeight: FontWeight.w400,
        ),
        decoration: InputDecoration(
          labelText: widget.label,
          hintText: widget.hint,
          labelStyle: TextStyle(
            color: _isFocused ? AppColors.primary : AppColors.textSecondary,
            fontWeight: FontWeight.w500,
          ),
          hintStyle: TextStyle(
            color: AppColors.grey.withValues(alpha: 0.7),
            fontSize: 14,
          ),
          prefixIcon: widget.prefixIcon != null
              ? Icon(
                  widget.prefixIcon,
                  color: _isFocused ? AppColors.primary : AppColors.grey,
                  size: 22,
                )
              : null,
          suffixIcon: widget.isPassword
              ? IconButton(
                  icon: Icon(
                    _obscureText
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    color: AppColors.grey,
                    size: 22,
                  ),
                  onPressed: () {
                    setState(() => _obscureText = !_obscureText);
                  },
                )
              : null,
          filled: true,
          fillColor: widget.enabled
              ? AppColors.offWhite
              : AppColors.lightGrey.withValues(alpha: 0.5),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: AppDimens.paddingMD,
            vertical: AppDimens.paddingMD,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppDimens.radiusMD),
            borderSide: const BorderSide(
              color: AppColors.lightGrey,
              width: 1,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppDimens.radiusMD),
            borderSide: const BorderSide(
              color: AppColors.lightGrey,
              width: 1,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppDimens.radiusMD),
            borderSide: const BorderSide(
              color: AppColors.primary,
              width: 2,
            ),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppDimens.radiusMD),
            borderSide: const BorderSide(
              color: AppColors.error,
              width: 1,
            ),
          ),
          focusedErrorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppDimens.radiusMD),
            borderSide: const BorderSide(
              color: AppColors.error,
              width: 2,
            ),
          ),
          disabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppDimens.radiusMD),
            borderSide: BorderSide(
              color: AppColors.lightGrey.withValues(alpha: 0.5),
              width: 1,
            ),
          ),
          errorStyle: const TextStyle(
            color: AppColors.error,
            fontSize: 12,
            fontWeight: FontWeight.w400,
          ),
        ),
        validator: widget.validator,
      ),
    );
  }
}
