---
name: buschmann-responsive-audit
description: Use when checking Buschmann layout behavior, navigation, image pairs, overflow, touch targets, sticky headers, crops, legal pages, or breakpoint regressions across mobile, tablet, and desktop.
---

# Buschmann Responsive Audit

Audit responsive behavior on all public pages at the ten required viewports in `buschmann-visual-qa`, with special scrutiny at 768–820 px.

Check navigation/sticky header, hero, image pairs, team, history, patisserie, catering, location, footer and legal content. Detect horizontal overflow, clipping, over-wide elements, touch targets below 44×44 CSS px, covered H1s, media hidden beneath the header, wrong `object-position`, extreme whitespace, narrow columns and off-screen navigation.

Measure `scrollWidth` against `clientWidth`; test 200% zoom. Report with the standard eight fields and do not edit during the read-only audit.
