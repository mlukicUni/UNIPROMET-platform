/**
 * ==========================================================================
 * UNIPROMET - SERVISNI MENI (dugme sa padajućim spiskom radnji)
 * Važi za svaki element [data-svc-menu]: klik na dugme otvara/zatvara spisak,
 * izbor stavke ga zatvara, a zatvara se i klikom van menija i tasterom Esc.
 * Stavke zadržavaju svoje ID-jeve, pa postojeći kod i prava pristupa rade kao ranije.
 * ==========================================================================
 */
(function () {
  'use strict';

  function closeAll(except) {
    document.querySelectorAll('[data-svc-menu].is-open').forEach(menu => {
      if (menu === except) return;
      menu.classList.remove('is-open');
      const t = menu.querySelector('.svc-menu-toggle');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest && e.target.closest('[data-svc-menu] .svc-menu-toggle');
    if (toggle) {
      const menu = toggle.closest('[data-svc-menu]');
      const open = !menu.classList.contains('is-open');
      closeAll(menu);
      menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    // Izbor stavke ili klik van menija zatvara meni (radnja stavke se izvrši normalno)
    closeAll(null);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll(null);
  });
})();
