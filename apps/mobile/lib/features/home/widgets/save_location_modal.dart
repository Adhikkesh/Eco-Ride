import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/map_service.dart';

/// Bottom sheet modal for saving/editing locations (Home, Work, Favourite).
/// Allows riders to manage their frequently used locations.
class SaveLocationModal extends StatefulWidget {
  final String? selectedName;
  final double? selectedLat;
  final double? selectedLng;
  final Map<String, dynamic>? existingLocations;
  final VoidCallback? onSaved;

  const SaveLocationModal({
    super.key,
    this.selectedName,
    this.selectedLat,
    this.selectedLng,
    this.existingLocations,
    this.onSaved,
  });

  @override
  State<SaveLocationModal> createState() => _SaveLocationModalState();
}

class _SaveLocationModalState extends State<SaveLocationModal> {
  bool _saving = false;
  String? _selectedType;
  String? _errorMessage;

  final List<Map<String, dynamic>> _types = [
    {'key': 'home', 'label': 'Home', 'icon': Icons.home_rounded, 'color': const Color(0xFF3B82F6)},
    {'key': 'work', 'label': 'Work', 'icon': Icons.work_rounded, 'color': const Color(0xFFF59E0B)},
    {'key': 'favourite', 'label': 'Favourite', 'icon': Icons.star_rounded, 'color': const Color(0xFFEF4444)},
  ];

  bool _hasExisting(String type) {
    if (widget.existingLocations == null) return false;
    final loc = widget.existingLocations![type];
    return loc != null && loc is Map && loc['name'] != null;
  }

  Future<void> _save() async {
    if (_selectedType == null) {
      setState(() => _errorMessage = 'Please select a location type');
      return;
    }
    if (widget.selectedLat == null || widget.selectedLng == null) {
      setState(() => _errorMessage = 'No location selected');
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    final success = await MapService.updateSavedLocation(
      _selectedType!,
      {
        'lat': widget.selectedLat,
        'lng': widget.selectedLng,
        'name': widget.selectedName ?? 'Saved Location',
      },
    );

    if (mounted) {
      if (success) {
        widget.onSaved?.call();
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${_selectedType![0].toUpperCase()}${_selectedType!.substring(1)} location saved!'),
            backgroundColor: const Color(0xFF22C55E),
          ),
        );
      } else {
        setState(() {
          _saving = false;
          _errorMessage = 'Failed to save. Please try again.';
        });
      }
    }
  }

  Future<void> _delete(String type) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Remove ${type[0].toUpperCase()}${type.substring(1)}?'),
        content: const Text('This saved location will be removed.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      setState(() => _saving = true);
      final success = await MapService.updateSavedLocation(type, null);
      if (mounted) {
        setState(() => _saving = false);
        if (success) {
          widget.onSaved?.call();
          Navigator.pop(context, true);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('${type[0].toUpperCase()}${type.substring(1)} location removed'),
              backgroundColor: Colors.orange,
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Title
          Text(
            'Save Location',
            style: GoogleFonts.inter(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          if (widget.selectedName != null)
            Text(
              widget.selectedName!,
              style: GoogleFonts.inter(fontSize: 13, color: Colors.grey[600]),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          const SizedBox(height: 20),

          // Type selection
          Text(
            'Save as:',
            style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.grey[700]),
          ),
          const SizedBox(height: 12),
          ...List.generate(_types.length, (i) {
            final type = _types[i];
            final key = type['key'] as String;
            final isSelected = _selectedType == key;
            final hasExisting = _hasExisting(key);
            final existingName = hasExisting ? widget.existingLocations![key]['name'] : null;

            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: GestureDetector(
                onTap: _saving ? null : () => setState(() => _selectedType = key),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  decoration: BoxDecoration(
                    color: isSelected ? (type['color'] as Color).withValues(alpha: 0.08) : Colors.grey[50],
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isSelected ? (type['color'] as Color) : Colors.grey[200]!,
                      width: isSelected ? 2 : 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(type['icon'] as IconData, color: type['color'] as Color, size: 22),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              type['label'] as String,
                              style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 15),
                            ),
                            if (hasExisting)
                              Text(
                                'Currently: $existingName',
                                style: GoogleFonts.inter(fontSize: 11, color: Colors.grey[500]),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                          ],
                        ),
                      ),
                      if (isSelected)
                        const Icon(Icons.check_circle_rounded, color: Color(0xFF22C55E), size: 22),
                      if (hasExisting && !isSelected)
                        GestureDetector(
                          onTap: () => _delete(key),
                          child: const Icon(Icons.delete_outline_rounded, color: Colors.red, size: 20),
                        ),
                    ],
                  ),
                ),
              ),
            );
          }),

          if (_errorMessage != null) ...[
            const SizedBox(height: 8),
            Text(_errorMessage!, style: GoogleFonts.inter(color: Colors.red, fontSize: 13)),
          ],

          const SizedBox(height: 16),

          // Save button
          GestureDetector(
            onTap: _saving ? null : _save,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 16),
              decoration: BoxDecoration(
                gradient: _saving ? null : AppGradients.primaryButton,
                color: _saving ? AppColors.grey : null,
                borderRadius: BorderRadius.circular(14),
                boxShadow: _saving ? [] : AppShadows.glow,
              ),
              child: Center(
                child: _saving
                    ? const SizedBox(
                        height: 22, width: 22,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                      )
                    : Text(
                        _hasExisting(_selectedType ?? '') ? 'Update Location' : 'Save Location',
                        style: GoogleFonts.inter(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
