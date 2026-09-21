/* economicsguru.com — nav.js
 * 1. Phone/tablet menu (<=1180px): the burger opens the nav as a full-height panel; tapping a topic
 *    expands its pages (accordion) instead of jumping to the overview.
 * 2. Deep links (/page/#canvasId from search or a jump bar): re-scroll once the
 *    KPI strip and charts have rendered, since they shift the page after load.
 */
(function () {
  var burger = document.querySelector('.burger');
  var nav = document.getElementById('site-nav');
  var phone = window.matchMedia('(max-width:1180px)');

  function close() {
    document.body.classList.remove('nav-open');
    if (burger) burger.setAttribute('aria-expanded', 'false');
  }
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var act = nav.querySelector('.item.active'); if (act) act.classList.add('open'); }
    });
    nav.addEventListener('click', function (e) {
      if (!phone.matches) return;
      var top = e.target.closest('.item.has-menu > a');
      if (!top) return;                       // a page link: let it navigate
      e.preventDefault();
      var item = top.parentNode, was = item.classList.contains('open');
      Array.prototype.forEach.call(nav.querySelectorAll('.item.open'), function (i) { i.classList.remove('open'); });
      if (!was) item.classList.add('open');
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    (phone.addEventListener ? phone.addEventListener.bind(phone, 'change') : phone.addListener.bind(phone))(function () { if (!phone.matches) close(); });
  }

  function toHash() {
    if (!location.hash || location.hash.length < 2) return;
    var el; try { el = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (err) { return; }
    if (el) el.scrollIntoView({ block: 'start' });
  }
  if (location.hash) { window.addEventListener('load', function () { setTimeout(toHash, 350); setTimeout(toHash, 1200); }); }
  window.addEventListener('hashchange', close);
})();
