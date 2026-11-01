'use strict';

(() => {
  const roomExamples = {
    friends: { kicker: 'ПОКЕР ДЛЯ СВОИХ', brand: 'ANTIKPOKER', description: 'Реальный игровой стол в браузере', emblem: '♠', title: 'Покер для своих', subtitle: 'Собирай друзей и играй за своим столом' },
    community: { kicker: 'СТОЛ СООБЩЕСТВА', brand: 'DLICOM POKER', description: 'Фон и фирменные элементы клуба', emblem: '✦', title: 'Dlicom Poker', subtitle: 'Свой арт, логотип и стиль игрового стола' },
    tournament: { kicker: 'ТУРНИР СООБЩЕСТВА', brand: 'FLUTON POKER', description: 'Фирменная обложка турнира', emblem: '♛', title: 'Fluton Poker · турнир', subtitle: 'Уникальный арт для турниров MTT' }
  };
  const roomPreview = document.getElementById('roomPreview');
  const roomButtons = document.querySelectorAll('.showcase-option');
  if (roomPreview && roomButtons.length) {
    const fields = {
      kicker: document.getElementById('coverKicker'),
      brand: document.getElementById('coverBrand'),
      description: document.getElementById('coverDescription'),
      emblem: document.getElementById('coverEmblem'),
      title: document.getElementById('previewTitle'),
      subtitle: document.getElementById('previewDescription')
    };
    let switchTimer;
    roomButtons.forEach(button => button.addEventListener('click', () => {
      const theme = button.dataset.room;
      if (roomPreview.dataset.theme === theme || !roomExamples[theme]) return;
      roomButtons.forEach(option => {
        const selected = option === button;
        option.classList.toggle('is-active', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      const example = roomExamples[theme];
      roomPreview.dataset.theme = theme;
      Object.entries(fields).forEach(([key, element]) => { if (element) element.textContent = example[key]; });
      document.getElementById('coverArtLabel').textContent = theme === 'friends' ? 'РЕАЛЬНЫЙ ИГРОВОЙ СТОЛ' : theme === 'tournament' ? 'ОФОРМЛЕНИЕ ТУРНИРА' : 'ПРИМЕР ОФОРМЛЕНИЯ';
      document.getElementById('demoBadgeText').textContent = theme === 'friends' ? 'СКРИНШОТ ИГРЫ' : theme === 'tournament' ? 'ДЕМО ТУРНИРА' : 'ДЕМО ОФОРМЛЕНИЯ';
      document.getElementById('showcaseBottomCopy').textContent = theme === 'friends' ? '♠ Настоящий стол для твоей компании' : theme === 'tournament' ? '♛ Турниры со своим фирменным стилем' : '✦ Логотипы, аватары, GIF и стикеры';
      roomPreview.classList.remove('is-switching');
      void roomPreview.offsetWidth;
      roomPreview.classList.add('is-switching');
      clearTimeout(switchTimer);
      switchTimer = setTimeout(() => roomPreview.classList.remove('is-switching'), 480);
    }));
  }

  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const targets = document.querySelectorAll('.proof-cell,.section-head,.story-panel,.story-quote,.feature,.step,.cta,.roadmap-section .eyebrow,.roadmap-section h2,.roadmap-sub');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .09, rootMargin: '0px 0px -25px 0px' });
    targets.forEach((element, index) => {
      element.classList.add('reveal-on-scroll');
      if (element.matches('.roadmap-section .eyebrow')) element.style.transitionDelay = '0ms';
      else if (element.matches('.roadmap-section h2')) element.style.transitionDelay = '90ms';
      else if (element.matches('.roadmap-sub')) element.style.transitionDelay = '180ms';
      else if (element.matches('.timeline .step')) element.style.transitionDelay = `${Array.prototype.indexOf.call(element.parentElement.children, element) * 105}ms`;
      else element.style.transitionDelay = `${(index % 3) * 75}ms`;
      observer.observe(element);
    });
    const timeline = document.querySelector('#roadmap .timeline');
    if (timeline) observer.observe(timeline);
    document.documentElement.classList.add('has-motion');
  }
})();
