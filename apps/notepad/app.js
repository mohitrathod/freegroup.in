(() => {
  const storageKey = "freegroup-shareable-notepad-v1";
  const editor = document.getElementById("note-editor");
  const autosaveStatus = document.getElementById("autosave-status");
  const shareButton = document.getElementById("share-button");
  const shareToast = document.getElementById("share-toast");
  let saveTimer;
  let toastTimer;

  function showToast(message) {
    shareToast.textContent = message;
    shareToast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      shareToast.hidden = true;
    }, 2400);
  }

  function clearSharedHash() {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search
    );
  }

  function readSharedNote() {
    const hash = window.location.hash;
    if (!hash.startsWith("#text=")) return { found: false };

    try {
      return { found: true, text: decodeURIComponent(hash.slice(6)) };
    } catch {
      return { found: true, invalid: true };
    }
  }

  function saveNow() {
    window.clearTimeout(saveTimer);

    try {
      window.localStorage.setItem(storageKey, editor.value);
      autosaveStatus.textContent = "Saved on this browser";
      return true;
    } catch {
      autosaveStatus.textContent = "Autosave is unavailable in this browser";
      return false;
    }
  }

  function makeShareUrl() {
    const url = new URL(window.location.href);
    url.hash = `text=${encodeURIComponent(editor.value)}`;
    return url.toString();
  }

  function restoreLocalNote() {
    try {
      const savedText = window.localStorage.getItem(storageKey);
      if (savedText !== null) editor.value = savedText;
      return true;
    } catch {
      return false;
    }
  }

  async function copyCurrentShareUrl() {
    const url = makeShareUrl();

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
      return;
    } catch {
      const temporaryInput = document.createElement("textarea");
      temporaryInput.value = url;
      temporaryInput.setAttribute("readonly", "");
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      let copied = false;

      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      temporaryInput.remove();

      showToast(copied ? "Link copied" : "Could not copy link");
    }
  }

  const sharedNote = readSharedNote();
  if (sharedNote.found) {
    clearSharedHash();
    if (sharedNote.invalid) {
      const restored = restoreLocalNote();
      autosaveStatus.textContent = restored
        ? "This share link could not be read; restored this browser’s note"
        : "This share link could not be read; autosave is unavailable";
    } else {
      editor.value = sharedNote.text;
      const saved = saveNow();
      autosaveStatus.textContent = saved
        ? "Shared note loaded and saved on this browser"
        : "Shared note loaded; autosave is unavailable";
    }
  } else {
    autosaveStatus.textContent = restoreLocalNote()
      ? "Autosaves in this browser"
      : "Autosave is unavailable in this browser";
  }

  editor.addEventListener("input", () => {
    autosaveStatus.textContent = "Saving…";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 250);
  });

  shareButton.addEventListener("click", copyCurrentShareUrl);
  window.addEventListener("pagehide", saveNow);
})();
