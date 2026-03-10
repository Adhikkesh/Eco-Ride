import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/services/sos_service.dart';

/// A floating SOS button that appears during active trips.
///
/// - Long-press (1.5 s) triggers the SOS alert to prevent accidental taps.
/// - Shows a confirmation dialog listing the emergency contacts.
/// - Sends a device-native SMS with the rider's live GPS location.
class SosButton extends StatefulWidget {
  /// Name of the current rider (included in the SMS body).
  final String? riderName;

  const SosButton({super.key, this.riderName});

  @override
  State<SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends State<SosButton>
    with SingleTickerProviderStateMixin {
  bool _isSending = false;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  // ── Manage contacts via SharedPreferences ──────────────────

  Future<List<String>> _loadContacts() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList('sos_emergency_contacts') ?? [];
  }

  Future<void> _saveContacts(List<String> contacts) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList('sos_emergency_contacts', contacts);
  }

  // ── SOS trigger ────────────────────────────────────────────

  Future<void> _onSosTrigger() async {
    final contacts = await _loadContacts();

    if (contacts.isEmpty) {
      if (!mounted) return;
      _showSetupDialog();
      return;
    }

    if (!mounted) return;

    // Confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Row(
          children: [
            const Icon(
              Icons.warning_amber_rounded,
              color: Colors.red,
              size: 28,
            ),
            const SizedBox(width: 10),
            Text(
              'Send SOS Alert?',
              style: GoogleFonts.inter(fontWeight: FontWeight.w700),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'An emergency SMS with your live location will be sent to:',
              style: GoogleFonts.inter(fontSize: 14, color: Colors.grey[700]),
            ),
            const SizedBox(height: 12),
            ...contacts.map(
              (c) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    const Icon(
                      Icons.person_outline,
                      size: 18,
                      color: Colors.red,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      c,
                      style: GoogleFonts.inter(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(
              'Cancel',
              style: GoogleFonts.inter(color: Colors.grey[600]),
            ),
          ),
          ElevatedButton.icon(
            onPressed: () => Navigator.pop(ctx, true),
            icon: const Icon(Icons.sos, size: 18),
            label: Text(
              'Send SOS',
              style: GoogleFonts.inter(fontWeight: FontWeight.w700),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _isSending = true);

    final result = await SosService.instance.triggerSos(
      emergencyContacts: contacts,
      riderName: widget.riderName,
    );

    if (!mounted) return;
    setState(() => _isSending = false);

    final isSuccess = result.status == SosStatus.success;
    final isPartial = result.status == SosStatus.partial;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              isSuccess
                  ? Icons.check_circle
                  : isPartial
                  ? Icons.warning_amber_rounded
                  : Icons.error,
              color: Colors.white,
              size: 20,
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(result.message)),
          ],
        ),
        backgroundColor: isSuccess
            ? Colors.green
            : isPartial
            ? Colors.orange
            : Colors.red,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.only(
          top: 10,
          left: 16,
          right: 16,
          bottom: 600,
        ),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  // ── Setup dialog (first-time or empty contacts) ────────────

  void _showSetupDialog() {
    final controller = TextEditingController();
    List<String> tempContacts = [];

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          title: Row(
            children: [
              const Icon(Icons.contact_phone, color: Colors.red, size: 26),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Setup Emergency Contacts',
                  style: GoogleFonts.inter(
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Add phone numbers that will receive your SOS alert with live location.',
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    color: Colors.grey[600],
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: controller,
                        keyboardType: TextInputType.phone,
                        decoration: InputDecoration(
                          hintText: '+91 XXXXX XXXXX',
                          hintStyle: GoogleFonts.inter(color: Colors.grey),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 10,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      onPressed: () {
                        final number = controller.text.trim();
                        if (number.isNotEmpty &&
                            !tempContacts.contains(number)) {
                          setDialogState(() => tempContacts.add(number));
                          controller.clear();
                        }
                      },
                      icon: const Icon(
                        Icons.add_circle,
                        color: Colors.green,
                        size: 32,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ...tempContacts.asMap().entries.map(
                  (e) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        const Icon(Icons.person, size: 18, color: Colors.red),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            e.value,
                            style: GoogleFonts.inter(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => setDialogState(
                            () => tempContacts.removeAt(e.key),
                          ),
                          icon: const Icon(
                            Icons.close,
                            size: 18,
                            color: Colors.grey,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(
                'Cancel',
                style: GoogleFonts.inter(color: Colors.grey[600]),
              ),
            ),
            ElevatedButton(
              onPressed: tempContacts.isEmpty
                  ? null
                  : () async {
                      // Request SMS permissions before saving
                      final hasPermission = await SosService.instance
                          .requestSmsPermissions();
                      if (!hasPermission) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'SMS permission required. Please enable in Settings.',
                              ),
                              backgroundColor: Colors.orange,
                            ),
                          );
                        }
                        return;
                      }

                      await _saveContacts(tempContacts);
                      if (ctx.mounted) Navigator.pop(ctx);
                      // Immediately trigger SOS after saving
                      _onSosTrigger();
                    },
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text(
                'Save & Send SOS',
                style: GoogleFonts.inter(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Long-press settings (edit contacts) ────────────────────

  void showContactsEditor() {
    _loadContacts().then((existingContacts) {
      if (!mounted) return;
      final controller = TextEditingController();
      List<String> tempContacts = List.from(existingContacts);

      showDialog(
        context: context,
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, setDialogState) => AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
            title: Row(
              children: [
                const Icon(Icons.edit, color: Colors.orange, size: 24),
                const SizedBox(width: 10),
                Text(
                  'Edit Emergency Contacts',
                  style: GoogleFonts.inter(
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: controller,
                          keyboardType: TextInputType.phone,
                          decoration: InputDecoration(
                            hintText: '+91 XXXXX XXXXX',
                            hintStyle: GoogleFonts.inter(color: Colors.grey),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        onPressed: () {
                          final number = controller.text.trim();
                          if (number.isNotEmpty &&
                              !tempContacts.contains(number)) {
                            setDialogState(() => tempContacts.add(number));
                            controller.clear();
                          }
                        },
                        icon: const Icon(
                          Icons.add_circle,
                          color: Colors.green,
                          size: 32,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (tempContacts.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Text(
                        'No contacts added yet.',
                        style: GoogleFonts.inter(
                          color: Colors.grey,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ...tempContacts.asMap().entries.map(
                    (e) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        children: [
                          const Icon(Icons.person, size: 18, color: Colors.red),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              e.value,
                              style: GoogleFonts.inter(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => setDialogState(
                              () => tempContacts.removeAt(e.key),
                            ),
                            icon: const Icon(
                              Icons.close,
                              size: 18,
                              color: Colors.grey,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(
                  'Cancel',
                  style: GoogleFonts.inter(color: Colors.grey[600]),
                ),
              ),
              ElevatedButton(
                onPressed: () async {
                  await _saveContacts(tempContacts);
                  if (ctx.mounted) Navigator.pop(ctx);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Emergency contacts updated.'),
                        backgroundColor: Colors.green,
                      ),
                    );
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.orange,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Text(
                  'Save',
                  style: GoogleFonts.inter(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
      );
    });
  }

  // ── Build ──────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulseController,
      builder: (context, child) {
        final scale = 1.0 + (_pulseController.value * 0.06);
        return Transform.scale(scale: _isSending ? 1.0 : scale, child: child);
      },
      child: GestureDetector(
        onTap: _isSending ? null : _onSosTrigger,
        onLongPress: showContactsEditor,
        child: Container(
          width: 60,
          height: 60,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFEF4444), Color(0xFFB91C1C)],
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.red.withOpacity(0.45),
                blurRadius: 16,
                spreadRadius: 2,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: _isSending
              ? const Padding(
                  padding: EdgeInsets.all(16),
                  child: CircularProgressIndicator(
                    color: Colors.white,
                    strokeWidth: 3,
                  ),
                )
              : Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.sos, color: Colors.white, size: 24),
                    Text(
                      'SOS',
                      style: GoogleFonts.inter(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
