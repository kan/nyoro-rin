<script setup lang="ts">
/**
 * The steps to add NYORO-RIN to the home screen on iPhone and iPad, which
 * have no API to install from a button (src/ui/install.ts). The wording is
 * TAKO-SEN's (its src/ui/InstallSteps.vue), so the two games read alike.
 */
</script>

<template>
  <div class="install-steps">
    <p class="note">
      iPhone と iPad では、Safari の共有メニューから NYORO-RIN
      をホーム画面に追加できます。
    </p>
    <ol>
      <li>
        共有ボタン（四角から上向きの矢印が出たアイコン）を押します。見当たらないときは、アドレスバーの「…」を押してから「共有」を選びます。
      </li>
      <li>
        一覧から「ホーム画面に追加」を選びます。見当たらないときは、一覧を下へスクロールするか「さらに表示」を押します。
      </li>
      <li>
        「Web
        アプリとして開く」が表示されたらオンのままにして、「追加」を押します。
      </li>
    </ol>
    <p class="note">
      ホーム画面の NYORO-RIN
      から開くと、アドレスバーのない画面で遊べます。通信できないときも遊べます。
    </p>
  </div>
</template>
