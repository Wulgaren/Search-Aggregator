/** Let Noir's injected stylesheet own the page canvas (html/body background). */
function syncNoirCanvas() {
  const noirActive = Boolean(document.querySelector('.noir'))
  document.documentElement.toggleAttribute('data-noir', noirActive)
}

document.addEventListener('noir-helper-ready', syncNoirCanvas)
document.addEventListener('noir-style-update', syncNoirCanvas)

new MutationObserver(syncNoirCanvas).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class'],
})

syncNoirCanvas()
