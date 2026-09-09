const modal = document.querySelector('#modal');
const searchPanel = document.querySelector('#search-panel');
const searchInput = document.querySelector('#search-input');

document.querySelectorAll('[data-upload]').forEach((button) => button.addEventListener('click', () => {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}));

document.querySelectorAll('.modal-close, .modal-done').forEach((button) => button.addEventListener('click', () => {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  searchPanel.classList.remove('open');
  searchPanel.setAttribute('aria-hidden', 'true');
}));

document.querySelector('[data-open-search]').addEventListener('click', () => {
  searchPanel.classList.add('open');
  searchPanel.setAttribute('aria-hidden', 'false');
  searchInput.focus();
});

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.filter.active').classList.remove('active');
  button.classList.add('active');
}));

document.querySelectorAll('.save-button').forEach((button) => button.addEventListener('click', () => {
  button.classList.toggle('saved');
  button.textContent = button.classList.contains('saved') ? '♥' : '♡';
}));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelectorAll('.open').forEach((item) => item.classList.remove('open'));
  if (event.key === 'Enter' && document.activeElement === searchInput && searchInput.value.trim()) {
    alert(`Пошук: ${searchInput.value.trim()} — результати скоро з'являться на Artas.`);
  }
});
