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
    /* Das Label wandert mit dem Zustand. Die Texte stehen als data-Attribute
       im HTML, damit hier keine deutschen Strings hart kodiert sind und die
       englische Seite dieselbe Datei nutzen kann. */
    var label = open ? btn.dataset.labelClose : btn.dataset.labelOpen;
    if (label) btn.setAttribute('aria-label', label);
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

  /* ---------- Kompakter Header beim Scrollen ----------
     Eine Klasse, zwei Zustände, sonst nichts: Höhe und Logogröße stehen im
     Stylesheet. Der Listener ist passiv und rechnet nur in einem
     requestAnimationFrame — kein Layout-Lesen pro Scrollereignis. Die
     Hysterese (32 px rein, 12 px raus) verhindert Flackern, wenn man genau
     auf der Schwelle stehen bleibt. */
  var brandhead = document.querySelector('.brandhead');
  if (brandhead) {
    var kompakt = false, tickt = false;
    var pruefen = function () {
      var y = window.scrollY;
      if (!kompakt && y > 32) { kompakt = true; brandhead.classList.add('is-scrolled'); }
      else if (kompakt && y < 12) { kompakt = false; brandhead.classList.remove('is-scrolled'); }
      tickt = false;
    };
    window.addEventListener('scroll', function () {
      if (!tickt) { tickt = true; window.requestAnimationFrame(pruefen); }
    }, { passive: true });
    pruefen();
  }

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
