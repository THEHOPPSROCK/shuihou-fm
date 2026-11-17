/* ==========================================================================
   水喉FM · 滚动进场（三个页面共用）
   没有它，带 .reveal 的区块会一直停在 opacity:0 —— 页面看上去是空白的。
   ========================================================================== */
(function () {
  var els = [].slice.call(document.querySelectorAll('.reveal'));
  if (!els.length) return;

  if (!('IntersectionObserver' in window)) {
    els.forEach(function (n) { n.classList.add('is-in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });

  els.forEach(function (n) { io.observe(n); });

  /* 兜底：保证「而家喺画面入面」嘅内容一定显示得到（打印、截图、
     深链跳转、切返嚟嘅标签页、观察器异常都唔会留低一片空白） */
  function rescue() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    els.forEach(function (n) {
      var r = n.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) n.classList.add('is-in');
    });
  }
  setTimeout(rescue, 800);
  setTimeout(rescue, 3000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) rescue(); });
  window.addEventListener('load', rescue);
})();
