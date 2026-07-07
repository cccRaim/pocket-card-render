// Import every material module for its side effect: each calls defineMaterial(...) to register its
// strategies. app.js imports THIS file once, after which getMaterial(kind) resolves every kind.
//
// To add materials for a NEW rarity, create a sibling module (e.g. ./sar.js) that imports
// `defineMaterial` and registers its kinds, then add one import line here. Nothing else changes.
import "./base.js";
import "./holo.js";
import "./frame2layer-ur.js";
import "./ur.js";
