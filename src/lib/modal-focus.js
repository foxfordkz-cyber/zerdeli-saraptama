import { useEffect } from 'react';

// Keep keyboard and assistive-technology navigation within the mobile sheet.
export function useModalFocus(ref, open) {
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return undefined;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const inerted = [];
    let branch = panel;
    while (branch.parentElement && branch !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || sibling.classList.contains('review-scrim') || sibling.inert) continue;
        sibling.inert = true;
        inerted.push(sibling);
      }
      branch = branch.parentElement;
    }
    const focusable = () => [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter((el) => !el.disabled && !el.closest('fieldset[disabled]') && el.tabIndex >= 0 && el.getClientRects().length);
    const focusFirst = () => (focusable()[0] || panel).focus({ preventScroll: true });
    const frame = requestAnimationFrame(focusFirst);
    const onKey = (event) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const onFocus = (event) => { if (!panel.contains(event.target)) focusFirst(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      for (const el of inerted) el.inert = false;
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else requestAnimationFrame(() => document.querySelector('.fab')?.focus({ preventScroll: true }));
    };
  }, [ref, open]);
}
