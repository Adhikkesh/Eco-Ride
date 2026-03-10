import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/map_service.dart';

/// Full-screen payment page shown to rider after ride completion.
/// Supports green points redemption and carbon offset toggle.
class PaymentScreen extends StatefulWidget {
  final String rideId;
  final double fare;

  const PaymentScreen({super.key, required this.rideId, required this.fare});

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> with TickerProviderStateMixin {
  bool _isLoading = false;
  bool _paymentSuccess = false;
  String? _errorMessage;
  late AnimationController _successController;
  late Animation<double> _scaleAnimation;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  // Green Points state
  bool _useGreenPoints = false;
  int _availableGreenPoints = 0;
  bool _loadingPoints = true;

  // Carbon Offset state
  bool _carbonOffset = false;
  static const double _carbonOffsetFee = 5.0;

  // Calculated amounts (from backend response)
  int _pointsUsed = 0;
  double _finalAmount = 0;

  @override
  void initState() {
    super.initState();
    _finalAmount = widget.fare;
    _successController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _scaleAnimation = CurvedAnimation(
      parent: _successController,
      curve: Curves.elasticOut,
    );
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.08).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
    _loadGreenPoints();
  }

  @override
  void dispose() {
    _successController.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  Future<void> _loadGreenPoints() async {
    final points = await MapService.getUserGreenPoints();
    if (mounted) {
      setState(() {
        _availableGreenPoints = points;
        _loadingPoints = false;
      });
    }
  }

  double get _displayFare {
    double fare = widget.fare;
    if (_useGreenPoints && _availableGreenPoints > 0) {
      fare -= _availableGreenPoints.toDouble().clamp(0, fare);
    }
    if (_carbonOffset) fare += _carbonOffsetFee;
    return fare < 0 ? 0 : fare;
  }

  Future<void> _handlePayment() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // 1. Create payment intent on backend with green points / carbon offset
      final result = await MapService.createPaymentIntent(
        widget.rideId,
        useGreenPoints: _useGreenPoints,
        carbonOffset: _carbonOffset,
      );
      if (result == null || result['success'] != true) {
        setState(() {
          _isLoading = false;
          _errorMessage = result?['message'] ?? 'Failed to create payment. Please try again.';
        });
        return;
      }

      final clientSecret = result['clientSecret'] as String?;
      final amount = (result['amount'] as num).toDouble();
      _pointsUsed = (result['pointsUsed'] as num?)?.toInt() ?? 0;
      _finalAmount = amount;

      // 2. Handle 100% green points coverage (no Stripe needed)
      if (clientSecret == null && amount == 0) {
        await MapService.confirmPayment(widget.rideId, 0, pointsUsed: _pointsUsed);
        setState(() {
          _isLoading = false;
          _paymentSuccess = true;
        });
        _successController.forward();
        await Future.delayed(const Duration(seconds: 3));
        if (mounted) Navigator.of(context).pop(true);
        return;
      }

      // 3. Initialize the Stripe PaymentSheet
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: clientSecret!,
          merchantDisplayName: 'Eco-Ride',
          style: ThemeMode.light,
          appearance: const PaymentSheetAppearance(
            colors: PaymentSheetAppearanceColors(
              primary: Color(0xFF22C55E),
            ),
            shapes: PaymentSheetShape(
              borderRadius: 16,
              shadow: PaymentSheetShadowParams(color: Colors.black12),
            ),
          ),
        ),
      );

      // 4. Present the payment sheet
      await Stripe.instance.presentPaymentSheet();

      // 5. Payment succeeded — confirm with backend
      await MapService.confirmPayment(widget.rideId, amount, pointsUsed: _pointsUsed);

      setState(() {
        _isLoading = false;
        _paymentSuccess = true;
      });
      _successController.forward();
      await Future.delayed(const Duration(seconds: 3));
      if (mounted) Navigator.of(context).pop(true);
    } on StripeException catch (e) {
      setState(() {
        _isLoading = false;
        if (e.error.code == FailureCode.Canceled) {
          _errorMessage = null;
        } else {
          _errorMessage = e.error.localizedMessage ?? 'Payment failed. Please retry.';
        }
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'An unexpected error occurred. Please try again.';
      });
      debugPrint('PaymentScreen: Error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: _paymentSuccess ? _buildSuccessView() : _buildPaymentView(),
      ),
    );
  }

  Widget _buildPaymentView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        children: [
          const SizedBox(height: 20),
          // Header
          Row(
            children: [
              IconButton(
                onPressed: () => Navigator.of(context).pop(false),
                icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
                style: IconButton.styleFrom(
                  backgroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  padding: const EdgeInsets.all(10),
                ),
              ),
              const SizedBox(width: 12),
              Text('Payment', style: GoogleFonts.inter(fontSize: 22, fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 32),

          // Trip Completed Card with fare
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
              ),
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF0F172A).withValues(alpha: 0.3),
                  blurRadius: 24,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF22C55E).withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.check_circle_rounded, color: Color(0xFF22C55E), size: 40),
                ),
                const SizedBox(height: 16),
                Text(
                  'Trip Completed!',
                  style: GoogleFonts.inter(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  'Please complete your payment',
                  style: GoogleFonts.inter(color: Colors.white60, fontSize: 13),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                  ),
                  child: Column(
                    children: [
                      Text(
                        'Amount to Pay',
                        style: GoogleFonts.inter(color: Colors.white54, fontSize: 12),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '₹${_displayFare.toStringAsFixed(0)}',
                        style: GoogleFonts.inter(
                          color: Colors.white,
                          fontSize: 42,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (_useGreenPoints && _availableGreenPoints > 0)
                        Text(
                          '(₹${widget.fare.toStringAsFixed(0)} - ₹${_availableGreenPoints.clamp(0, widget.fare.toInt())} points)',
                          style: GoogleFonts.inter(color: const Color(0xFF22C55E), fontSize: 12),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),

          // Green Points Card
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 16, offset: const Offset(0, 4)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(colors: [Color(0xFF22C55E), Color(0xFF10B981)]),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.eco_rounded, color: Colors.white, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Green Points',
                            style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 15),
                          ),
                          const SizedBox(height: 2),
                          _loadingPoints
                              ? Text('Loading...', style: GoogleFonts.inter(color: Colors.grey, fontSize: 12))
                              : Text(
                                  '$_availableGreenPoints points available (₹$_availableGreenPoints value)',
                                  style: GoogleFonts.inter(color: Colors.grey[600], fontSize: 12),
                                ),
                        ],
                      ),
                    ),
                    Switch.adaptive(
                      value: _useGreenPoints,
                      onChanged: (_availableGreenPoints > 0 && !_loadingPoints)
                          ? (val) => setState(() => _useGreenPoints = val)
                          : null,
                      activeColor: const Color(0xFF22C55E),
                    ),
                  ],
                ),
                if (_useGreenPoints && _availableGreenPoints > 0) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF22C55E).withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.savings_rounded, color: Color(0xFF22C55E), size: 18),
                        const SizedBox(width: 8),
                        Text(
                          'You save ₹${_availableGreenPoints.clamp(0, widget.fare.toInt())} with Green Points!',
                          style: GoogleFonts.inter(
                            color: const Color(0xFF22C55E),
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 12),

          // Carbon Offset Card
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 16, offset: const Offset(0, 4)),
              ],
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [Color(0xFF3B82F6), Color(0xFF2563EB)]),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.park_rounded, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Carbon Offset',
                        style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Add ₹${_carbonOffsetFee.toStringAsFixed(0)} to offset your ride\'s CO₂',
                        style: GoogleFonts.inter(color: Colors.grey[600], fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Switch.adaptive(
                  value: _carbonOffset,
                  onChanged: (val) => setState(() => _carbonOffset = val),
                  activeColor: const Color(0xFF3B82F6),
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),

          // Payment Summary
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 16, offset: const Offset(0, 4)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Payment Summary', style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 15)),
                const SizedBox(height: 16),
                _buildSummaryRow('Ride Fare', '₹${widget.fare.toStringAsFixed(0)}'),
                if (_useGreenPoints && _availableGreenPoints > 0) ...[
                  const SizedBox(height: 8),
                  _buildSummaryRow(
                    'Green Points Discount',
                    '- ₹${_availableGreenPoints.clamp(0, widget.fare.toInt())}',
                    valueColor: const Color(0xFF22C55E),
                  ),
                ],
                if (_carbonOffset) ...[
                  const SizedBox(height: 8),
                  _buildSummaryRow('Carbon Offset', '+ ₹${_carbonOffsetFee.toStringAsFixed(0)}',
                      valueColor: const Color(0xFF3B82F6)),
                ],
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Divider(height: 1),
                ),
                _buildSummaryRow('Total', '₹${_displayFare.toStringAsFixed(0)}', isBold: true),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Secure payment badge
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.lock_rounded, size: 14, color: Colors.grey[500]),
              const SizedBox(width: 6),
              Text(
                'Secured by Stripe',
                style: GoogleFonts.inter(color: Colors.grey[500], fontSize: 12, fontWeight: FontWeight.w500),
              ),
            ],
          ),

          const SizedBox(height: 24),

          // Error message
          if (_errorMessage != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFFECACA)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline_rounded, color: Color(0xFFEF4444), size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _errorMessage!,
                      style: GoogleFonts.inter(color: const Color(0xFFDC2626), fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),

          // Pay Now Button
          AnimatedBuilder(
            animation: _pulseAnimation,
            builder: (context, child) {
              return Transform.scale(
                scale: _isLoading ? 1.0 : _pulseAnimation.value,
                child: child,
              );
            },
            child: GestureDetector(
              onTap: _isLoading ? null : _handlePayment,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 18),
                decoration: BoxDecoration(
                  gradient: _isLoading ? null : AppGradients.primaryButton,
                  color: _isLoading ? AppColors.grey : null,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: _isLoading ? [] : AppShadows.glow,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (_isLoading)
                      const SizedBox(
                        height: 22,
                        width: 22,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                      )
                    else ...[
                      const Icon(Icons.lock_rounded, color: Colors.white, size: 20),
                      const SizedBox(width: 10),
                      Text(
                        _displayFare == 0
                            ? 'Pay with Green Points'
                            : (_errorMessage != null
                                ? 'Retry Payment'
                                : 'Pay ₹${_displayFare.toStringAsFixed(0)}'),
                        style: GoogleFonts.inter(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value, {bool isBold = false, Color? valueColor}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
            color: isBold ? Colors.black87 : Colors.grey[600],
            fontSize: 14,
            fontWeight: isBold ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
        Text(
          value,
          style: GoogleFonts.inter(
            color: valueColor ?? (isBold ? const Color(0xFF22C55E) : Colors.black87),
            fontSize: isBold ? 16 : 14,
            fontWeight: isBold ? FontWeight.bold : FontWeight.w500,
          ),
        ),
      ],
    );
  }

  Widget _buildSuccessView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          ScaleTransition(
            scale: _scaleAnimation,
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF22C55E), Color(0xFF10B981)],
                ),
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF22C55E).withValues(alpha: 0.4),
                    blurRadius: 40,
                    spreadRadius: 8,
                  ),
                ],
              ),
              child: const Icon(Icons.check_rounded, color: Colors.white, size: 64),
            ),
          ),
          const SizedBox(height: 32),
          Text(
            'Payment Successful!',
            style: GoogleFonts.inter(
              fontSize: 26,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF22C55E),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _pointsUsed > 0
                ? '₹${_finalAmount.toStringAsFixed(0)} paid (₹$_pointsUsed from Green Points)'
                : '₹${widget.fare.toStringAsFixed(0)} paid successfully',
            style: GoogleFonts.inter(fontSize: 16, color: Colors.grey[600]),
          ),
          const SizedBox(height: 28),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 48),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF22C55E).withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFF22C55E).withValues(alpha: 0.2)),
            ),
            child: Text(
              '🎉 Thank you for riding with Eco-Ride!',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                color: const Color(0xFF22C55E),
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
