# Skill Inventory

| Skill/Fähigkeit | Ort | Scope | Buschmann | Abhängigkeit / Überschneidung |
|---|---|---|---|---|
| Browser | Codex-Plugin global | global | ja | In-App-Browser; in dieser Sitzung Sandbox-Metadatenfehler, Chrome-Fallback |
| frontend-testing-debugging | Build Web Apps Plugin | global | ja | Browser-first Frontend-QA; ergänzt Visual/Responsive |
| impeccable | `~/.agents/skills/impeccable` | global | ja | Design-, A11y-, Performance- und Responsive-Audit; überschneidet Visual QA |
| systematic-debugging / verification-before-completion | Superpowers Plugin | global | ja | allgemeine Diagnose/Abschlussverifikation |
| skill-creator / skill-installer | `~/.codex/skills/.system` | global | Setup | offizielles Erstellen/Installieren; keine Blindinstallation erfolgt |
| design-dna | `~/.claude/skills/design-dna` | global Claude | bedingt | Designsystemanalyse; Brand-Review überschneidet projektspezifisch |
| GSAP core/performance/scrolltrigger/timeline | `~/.claude/skills/` | global Claude | ja | Motion und Reduced Motion; vorhandenes Setup erhalten |
| motion-design | `~/.claude/skills/motion-design` | global Claude | bedingt | Motion-Polish |
| Three.js-Skills | `~/.claude/skills/` | global Claude | nein | öffentliche Seite benötigt sie nicht; unreferenzierte lokale Paketdateien wurden nicht übernommen |
| buschmann-visual-qa | `.agents/skills/` | Projekt | ja | Browser/Impeccable, markenspezifische Viewports |
| buschmann-responsive-audit | `.agents/skills/` | Projekt | ja | fokussiert Breakpoints/Overflow |
| buschmann-brand-review | `.agents/skills/` | Projekt | ja | Fakten, Bildfamilien, Art Direction |
| buschmann-content-i18n | `.agents/skills/` | Projekt | ja | DE/EN-Fakten und Ton |
| buschmann-seo-a11y | `.agents/skills/` | Projekt | ja | SEO + A11y ohne Toolzwang |
| buschmann-release-check | `.agents/skills/` | Projekt | ja | letzter nicht-deployender Gatekeeper |

Nicht separat vorhanden/installiert: Lighthouse CLI, axe CLI, dedizierter Linkchecker. Ihre Funktionen wurden soweit möglich mit Browser, HTTP- und statischer Prüfung abgedeckt. Keine unbekannten Repositories oder globalen Duplikate installiert.
