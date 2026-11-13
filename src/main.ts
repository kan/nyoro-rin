import { createApp } from "vue";
import App from "./App.vue";
import { startId } from "./ui/auth";
import "./styles.css";

// The kan-game.app ID comes in the background; play never waits for it.
startId();
createApp(App).mount("#app");
