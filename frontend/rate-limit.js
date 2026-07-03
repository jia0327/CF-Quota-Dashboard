/**
 * Show a countdown after a 429 rate-limit response and keep the button disabled.
 * Resolves when the countdown finishes and the button is re-enabled.
 */
export function startRateLimitCountdown({
  buttonEl,
  messageEl,
  retryAfterSeconds,
  buttonLabel = '请稍后再试',
}) {
  const seconds = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 10));
  const originalText = buttonEl?.dataset.originalText || buttonEl?.textContent || buttonLabel;

  if (buttonEl) {
    buttonEl.dataset.originalText = originalText;
    buttonEl.disabled = true;
  }

  let remaining = seconds;

  const updateUI = () => {
    const text = `请 ${remaining} 秒后再试`;
    if (messageEl) {
      messageEl.textContent = text;
      messageEl.className = 'form-message form-message--error';
    }
    if (buttonEl) {
      buttonEl.textContent = text;
    }
  };

  updateUI();

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.textContent = originalText;
        }
        resolve();
        return;
      }
      updateUI();
    }, 1000);
  });
}
