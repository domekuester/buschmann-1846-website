---
name: buschmann-release-check
description: Use as the final non-deploying release gate after Buschmann audits and fixes, or when verifying whether the six public pages are ready for handoff.
---

# Buschmann Release Check

Never deploy, commit, push or change hosting. Verify six public pages, internal/external links, assets, fonts, images, console, network, cookies/storage, third-party requests, SEO, sitemap/robots, responsiveness, accessibility and legal-page accessibility.

Confirm the future upload excludes `.git/`, `.github/`, `.claude/`, `.codex/`, `.agents/`, `audit/`, `content/`, `node_modules/`, drafts, screenshots, internal Markdown and debug files; document only, do not delete.

Return exactly one status with reasons: `PASS`, `PASS WITH TODO`, or `FAIL`. `PASS WITH TODO` is valid only for a replacement Claudia photo, final IONOS confirmation/domain switch, or post-launch live test.
