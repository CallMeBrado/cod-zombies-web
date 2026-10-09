# Controller aim assist and interaction reach

WaW, BO1, BO2 and the Spaceland test share controller aim assist. It is enabled
by default at 75% strength. The standard game menus expose **Options →
Controller → Aim assist / Aim assist strength**; preferences use the existing
controller settings store. Mouse and keyboard input is unaffected.

The reticle slows over nearby visible enemies. Moving a stick permits gentle,
bounded rotational support. ADS alone does not snap to a target, and full
look-stick deflection lets the player turn away. Corpses, distant targets and
targets outside the forward aim area are ignored. Native world traces check
visibility; at most three candidates are checked per scheduled scan.

Wall buys, doors, machines, boxes and other shared Use interactions now need
the player within 60 game units and facing the target. Barrier repair also
uses 60 units, measured from the physical board origins rather than the
zombie's landing waypoint. When a damaged barrier is eligible, its repair
prompt and held Use take priority over a nearby purchase. Finishing a repair
does not automatically buy an item while Use remains held.

The Spaceland wall buy uses the same reach/facing helper for both its prompt
and its purchase action.

Run `npm run test:controllers` and `npm run test:interactions`. Tests cover
30–240 FPS aim behavior, visibility/ownership exclusions, settings persistence,
existing controller mappings and input loss, and overlapping barrier/purchase
cases on the actual WaW, BO1 and BO2 engine classes. Co-op regression checks
are available through `npm run test:coop`.
