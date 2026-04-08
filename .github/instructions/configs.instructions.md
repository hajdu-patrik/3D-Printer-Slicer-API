---
applyTo: "configs/**"
---

# Configs Folder Instructions

Last synchronized: 2026-04-08

## Scope
- pricing.json is runtime pricing source of truth.
- pricing.example.json is the template.
- prusa/*.ini and orca/*.json define slicing profiles.

## Rules
- Keep configs at repository root in configs/.
- Keep pricing schema shape intact for FDM and SLA objects.
- Do not rename profile files unless profile resolution logic is updated as well.

## Related Env Keys
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
