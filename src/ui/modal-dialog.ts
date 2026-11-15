import { type Ref, nextTick, watch } from "vue";

/**
 * A native modal <dialog> driven by an `open` prop: shown with showModal
 * when it opens, and closed through the parent (Esc and a tap on the
 * backdrop ask the parent to close, which then turns `open` off). A dialog
 * mounted already open (one loaded only when needed) shows at once.
 */
export function useModalDialog(
  dialog: Ref<HTMLDialogElement | undefined>,
  open: () => boolean,
  close: () => void,
  onOpen: () => void = () => {},
) {
  watch(
    open,
    async (isOpen) => {
      if (!isOpen) {
        dialog.value?.close();
        return;
      }
      onOpen();
      await nextTick();
      if (!dialog.value?.open) dialog.value?.showModal();
    },
    { immediate: true },
  );

  function onCancel(event: Event): void {
    event.preventDefault();
    close();
  }

  function onDialogClick(event: MouseEvent): void {
    if (event.target === dialog.value) close();
  }

  return { onCancel, onDialogClick };
}
