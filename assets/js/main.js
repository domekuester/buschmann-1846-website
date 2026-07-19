/* Buschmann 1846 — Menü, Bild-Reveal, Wirbelsäulen-Punkt */
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

  /* ---------- Wirbelsäulen-Punkt ---------- */
  var dot = document.getElementById('spinedot');
  var sections = Array.prototype.slice.call(
    document.querySelectorAll('[data-spine]')
  );
  if (dot && sections.length && 'IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var i = sections.indexOf(entry.target);
          dot.style.top = (8 + (i / (sections.length - 1)) * 84) + '%';
        }
      });
    }, { rootMargin: '-40% 0px -50% 0px' });
    sections.forEach(function (s) { so.observe(s); });
  }
})();
