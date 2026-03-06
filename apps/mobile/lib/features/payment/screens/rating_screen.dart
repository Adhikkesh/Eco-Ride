import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/map_service.dart';

/// Full-screen rating page shown after successful payment.
/// Mirrors the web app's RatingModal component.
class RatingScreen extends StatefulWidget {
  final String rideId;
  final String driverId;
  final String driverName;

  const RatingScreen({
    super.key,
    required this.rideId,
    required this.driverId,
    required this.driverName,
  });

  @override
  State<RatingScreen> createState() => _RatingScreenState();
}

class _RatingScreenState extends State<RatingScreen> with SingleTickerProviderStateMixin {
  int _rating = 4;
  String _comment = '';
  bool _isSubmitting = false;
  String? _error;
  late AnimationController _starController;
  late Animation<double> _starAnimation;

  static const _feedbackLabels = ['', 'Terrible', 'Poor', 'Good', 'Very Good', 'Excellent!'];

  @override
  void initState() {
    super.initState();
    _starController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _starAnimation = CurvedAnimation(parent: _starController, curve: Curves.elasticOut);
    _starController.forward();
  }

  @override
  void dispose() {
    _starController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });

    try {
      final result = await MapService.submitRating(
        rideId: widget.rideId,
        driverId: widget.driverId,
        rating: _rating,
        comment: _comment,
      );

      if (result != null && result['success'] == true) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        setState(() {
          _error = result?['message'] ?? 'Failed to submit rating. Please try again.';
          _isSubmitting = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Network error. Please try again.';
        _isSubmitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            children: [
              const SizedBox(height: 16),
              // Skip button
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: Text(
                    'Skip',
                    style: GoogleFonts.inter(color: Colors.white54, fontSize: 14, fontWeight: FontWeight.w500),
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // Driver avatar
              Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(colors: [Color(0xFF22C55E), Color(0xFF10B981)]),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF22C55E).withValues(alpha: 0.3),
                      blurRadius: 24,
                      spreadRadius: 4,
                    ),
                  ],
                ),
                child: const CircleAvatar(
                  radius: 40,
                  backgroundColor: Color(0xFF1E293B),
                  child: Icon(Icons.person_rounded, size: 44, color: Color(0xFF22C55E)),
                ),
              ),
              const SizedBox(height: 24),

              // Title
              Text(
                'Rate Your Trip',
                style: GoogleFonts.inter(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                'How was your ride with ${widget.driverName}?',
                style: GoogleFonts.inter(color: const Color(0xFF94A3B8), fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 36),

              // Stars
              ScaleTransition(
                scale: _starAnimation,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(5, (index) {
                    final star = index + 1;
                    return GestureDetector(
                      onTap: () {
                        setState(() => _rating = star);
                        _starController.reset();
                        _starController.forward();
                      },
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        child: Icon(
                          star <= _rating ? Icons.star_rounded : Icons.star_outline_rounded,
                          size: 48,
                          color: star <= _rating ? const Color(0xFFFBBF24) : const Color(0xFF475569),
                        ),
                      ),
                    );
                  }),
                ),
              ),
              const SizedBox(height: 16),

              // Feedback label
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                child: Text(
                  _feedbackLabels[_rating],
                  key: ValueKey(_rating),
                  style: GoogleFonts.inter(
                    color: const Color(0xFF22C55E),
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 32),

              // Comment field
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Additional Comments (Optional)',
                    style: GoogleFonts.inter(color: const Color(0xFFE2E8F0), fontSize: 14, fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E293B),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                    ),
                    child: TextField(
                      maxLines: 4,
                      style: GoogleFonts.inter(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'Tell us more about your experience...',
                        hintStyle: GoogleFonts.inter(color: const Color(0xFF64748B), fontSize: 14),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.all(14),
                      ),
                      onChanged: (value) => _comment = value,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Error
              if (_error != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFEF4444).withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    _error!,
                    style: GoogleFonts.inter(color: const Color(0xFFEF4444), fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ),

              // Submit button
              GestureDetector(
                onTap: _isSubmitting ? null : _handleSubmit,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 18),
                  decoration: BoxDecoration(
                    gradient: _isSubmitting ? null : AppGradients.primaryButton,
                    color: _isSubmitting ? const Color(0xFF475569) : null,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: _isSubmitting
                        ? []
                        : [
                            BoxShadow(
                              color: const Color(0xFF22C55E).withValues(alpha: 0.3),
                              blurRadius: 20,
                              offset: const Offset(0, 8),
                            ),
                          ],
                  ),
                  child: Center(
                    child: _isSubmitting
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                          )
                        : Text(
                            'Submit Rating',
                            style: GoogleFonts.inter(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700),
                          ),
                  ),
                ),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}
