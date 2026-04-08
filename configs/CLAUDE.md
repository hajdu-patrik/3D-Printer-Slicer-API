# Configs Folder - Local Claude Guide

Last synchronized: 2026-04-08

## Scope
This folder contains runtime configuration files used by slicing and pricing.

## Files
- configs/pricing.json
  - Active pricing matrix for FDM and SLA materials.
  - Read and written by app/services/pricing.service.js.

- configs/pricing.example.json
  - Template used to initialize pricing.json when missing.

- configs/prusa/*.ini
  - Prusa profile presets by layer height.
  - Includes FDM and SLA presets.

- configs/orca/*.json
  - Orca machine and process presets.
  - Machine and process compatibility must be respected.

## Safety Constraints
- Keep this folder at repository root (not under app/).
- Do not rename existing profile files without updating profile resolution logic.
- Preserve pricing schema shape:
  - FDM: material -> number
  - SLA: material -> number

## Related Runtime Keys
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
