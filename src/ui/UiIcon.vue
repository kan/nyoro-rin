<script setup lang="ts">
defineProps<{
  name:
    | "menu"
    | "close"
    | "undo"
    | "redo"
    | "reset"
    | "next"
    | "hint"
    | "copy"
    | "clock"
    | "difficulty"
    | "line"
    | "cross"
    | "zoom"
    | "seed"
    | "settings"
    | "help"
    | "pause"
    | "records";
}>();
</script>

<template>
  <svg
    class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-if="name === 'menu'" d="M4 6h16M4 12h16M4 18h16" />
    <path v-else-if="name === 'close'" d="m6 6 12 12M18 6 6 18" />
    <path
      v-else-if="name === 'undo'"
      d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
    />
    <path
      v-else-if="name === 'redo'"
      d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13"
    />
    <path v-else-if="name === 'reset'" d="M4 11a8 8 0 1 1 2 7M4 4v7h7" />
    <path v-else-if="name === 'next'" d="M4 12h12m-6-6 6 6-6 6M20 5v14" />
    <template v-else-if="name === 'hint'">
      <path d="M9 16c0-3-4-4-4-7a7 7 0 0 1 14 0c0 3-4 4-4 7ZM9 19h6M10 22h4" />
      <path d="M12 16v-5m-2-2 2 2 2-2" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </template>
    <path
      v-else-if="name === 'difficulty'"
      d="M4 20v-5h3v5ZM10.5 20V9h3v11ZM17 20V3h3v17Z"
    />
    <template v-else-if="name === 'line'">
      <circle cx="4" cy="12" r="1.5" fill="currentColor" />
      <path d="M5.5 12h13" stroke-width="3" />
      <circle cx="20" cy="12" r="1.5" fill="currentColor" />
    </template>
    <template v-else-if="name === 'cross'">
      <circle cx="4" cy="12" r="1.5" fill="currentColor" />
      <path d="m9 9 6 6m0-6-6 6" />
      <circle cx="20" cy="12" r="1.5" fill="currentColor" />
    </template>
    <template v-else-if="name === 'zoom'">
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </template>
    <path v-else-if="name === 'seed'" d="m9 3-3 18M18 3l-3 18M4 8h17M3 16h17" />
    <template v-else-if="name === 'settings'">
      <path
        d="m9 3-.7 2.5-1.7 1L4 6l-2 3.5 1.9 1.8v1.9L2 15l2 3.5 2.6-.5 1.7 1L9 21h6l.7-2.5 1.7-1 2.6.5 2-3.5-1.9-1.8v-1.9L22 9l-2-3.5-2.6.5-1.7-1L15 3Z"
      />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'help'">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h0" />
    </template>
    <path v-else-if="name === 'pause'" d="M9 5v14M15 5v14" />
    <path v-else-if="name === 'records'" d="M4 20h16M7 16V10m5 6V5m5 11v-4" />
  </svg>
</template>
