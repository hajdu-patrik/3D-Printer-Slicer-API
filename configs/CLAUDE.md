# Configs Folder - Local Claude Guide

Last synchronized: 2026-11-27

## Scope

This folder contains runtime configuration files used by slicing and pricing.

## Files

- configs/pricing.json
  - Active pricing matrix for FDM and SLA materials (hourly rate per material).
  - Optional `materialCost` (`FDM`: HUF/g, `SLA`: HUF/ml per material) and `setupFee` (`FDM`/`SLA`: flat HUF per order) sections.
  - Read and written by app/services/pricing.service.js.

- configs/pricing.example.json
  - Template used to initialize pricing.json when missing.

- configs/prusa/*.ini
  - Prusa profile presets by layer height.
  - Includes FDM and SLA presets.

- configs/prusa/materials/FDM_<MAT>.ini and SLA_<MAT>_<layer>mm.ini
  - Material overlays merged into the Prusa runtime profile (safe-name regex; unknown material uses the base profile).
  - Values are copied from the official PrusaSlicer 2.8.1 presets: FDM from `[filament:Generic PLA|PETG|ABS|FLEX]` (PrusaResearch.ini, TPU -> Generic FLEX), SLA from `[sla_material:Prusament Resin Tough Prusa Orange|Flex80 Black @<layer> SL1S]` (PrusaResearchSLA.ini). Each file header names its source preset; re-sync them when the bundled PrusaSlicer version changes.

- configs/orca/*.json
  - Orca machine and process presets.
  - Machine and process compatibility must be respected.

- configs/orca/materials/FDM_<MAT>.json
  - Orca filament presets passed via `--load-filaments`.
  - Values are copied from the official OrcaSlicer 2.3.1 BBL presets `Generic PLA|PETG|ABS|TPU` (inheritance resolved; all list Bambu Lab P1S 0.4 nozzle as compatible). Re-sync them when the bundled OrcaSlicer version changes.

## Safety Constraints

- Keep this folder at repository root (not under app/).
- Do not rename existing profile files without updating profile resolution logic.
- Preserve pricing schema shape:
  - FDM: material -> number (HUF/hour)
  - SLA: material -> number (HUF/hour)
  - Optional `materialCost`: FDM/SLA material -> number (HUF/g and HUF/ml)
  - Optional `setupFee`: FDM and SLA -> number (flat HUF per order)
  - Files without the optional sections must keep loading (cost 0, fee 0).
- Prusa FDM profiles keep a 256x256 bed with max_print_height 256; SLA profiles keep bed_shape 120x120 and max_print_height 150 (the Prusa `--center` and build-volume limits are derived from these).

## Related Runtime Keys

- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
- DEBUG_COMMAND_LOGS
- SLICE_RESULT_CACHE_TTL_MS (profile/material file mtime and size are part of the cache key, so profile edits invalidate cached results)

## Notes
- Prusa runtime profiles are generated dynamically from base ini files and request options.
- Orca runtime process profiles are generated dynamically from base json profiles and request options.
- Profile overrides from requests are filename-only and sanitized before lookup.
