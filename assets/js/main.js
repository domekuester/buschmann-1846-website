/* Buschmann 1846 — Mobiles Menü und einmaliges Bild-Reveal */
(function () {
  'use strict';

  /* ---------- Mobiles Menü (Fokusfalle, Escape) ---------- */
  var menu = document.getElementById('mmenu');
  var btn = document.querySelector('.menu-btn');
  var closeBtn = menu.querySelector('.m-close');

  function focusables() {
    return menu.querySelectorAll('a[href], button');
  }
  function setMenu(open) {
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      closeBtn.focus();
    } else {
      btn.focus();
    }
  }
  btn.addEventListener('click', function () { setMenu(true); });
  closeBtn.addEventListener('click', function () { setMenu(false); });
  menu.querySelectorAll('nav a').forEach(function (a) {
    a.addEventListener('click', function () { setMenu(false); });
  });
  document.addEventListener('keydown', function (e) {
    if (!menu.classList.contains('open')) return;
    if (e.key === 'Escape') { setMenu(false); return; }
    if (e.key !== 'Tab') return;
    var els = focusables();
    var first = els[0];
    var last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });

  /* ---------- Sprachwechsel: Abschnitt mitnehmen ----------
     Die Sprachlinks funktionieren ohne JavaScript vollständig — sie zeigen
     auf / bzw. /en/. Läuft JS, hängen wir zusätzlich den passenden Anker
     der Zielsprache an, damit man nach dem Wechsel nicht wieder oben landet.
     Die Sektions-IDs unterscheiden sich pro Sprache; alles, was hier nicht
     steht (etwa #patisserie oder #catering), heißt in beiden Sprachen gleich
     und wird unverändert übernommen. */
  var SECTION_MAP = {
    geschichte: 'history', chronologie: 'timeline', backstube: 'bakery',
    galerie: 'pictures', samstag: 'saturday', standort: 'location'
  };
  var REVERSE = {};
  Object.keys(SECTION_MAP).forEach(function (de) { REVERSE[SECTION_MAP[de]] = de; });

  document.querySelectorAll('.lang a:not([aria-current])').forEach(function (link) {
    link.addEventListener('click', function () {
      var id = window.location.hash.replace('#', '');
      if (!id) return;
      var ziel = SECTION_MAP[id] || REVERSE[id] || id;
      if (document.getElementById(id) || SECTION_MAP[id] || REVERSE[id]) {
        link.href = link.getAttribute('href') + '#' + ziel;
      }
    });
  });

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Bild-Reveal, einmalig ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  }
})();
